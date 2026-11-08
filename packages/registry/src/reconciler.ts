import { batch, computed } from '@preact/signals-core'
import type {
  Facet,
  Instance,
  Item,
  Origin,
  ScopeHost,
  Signal,
  Subtree,
} from './algebra'
import { createScope } from './algebra'
import { formatPath, type ItemPath } from './path'
import { DependencyCycleError, plan } from './planner'

/** Retained ownership is separate from replaceable children and their bindings. */
interface Mounted {
  readonly instance: Instance
  readonly children: readonly Item[]
  readonly origin: Origin
}

/** Synchronous acquisition, atomic publication, and awaitable resource release. */
export class Reconciler implements ScopeHost {
  private roots: readonly Item[] = []
  private mounted = new Map<Subtree, Mounted>()
  private clears = new Set<() => void>()
  private busy = false
  private acquiring = false

  observe<I, O>(facet: Facet<I, O>): Signal<O> {
    return computed(() => {
      if (this.acquiring)
        throw new Error('Defer observations until acquisition completes')
      return facet.cell(this).output.value
    })
  }

  configure(items: readonly Item[]): Promise<void> {
    return this.reconcile(Object.freeze([...items]))
  }

  replace(subtree: Subtree, items: readonly Item[]): Promise<void> {
    return this.reconcile(this.roots, {
      subtree,
      items: Object.freeze([...items]),
    })
  }

  private async reconcile(
    roots: readonly Item[],
    replacement?: { subtree: Subtree; items: readonly Item[] }
  ): Promise<void> {
    if (this.busy) throw new Error('A reconciliation is already in progress')
    if (replacement && !this.mounted.has(replacement.subtree)) {
      throw new Error('Cannot replace an unmounted subtree')
    }
    this.busy = true
    const next = new Map<Subtree, Mounted>()
    const commits = new Set<() => void>()
    const clears = new Set<() => void>()
    const created: Instance[] = []
    const seen = new Set<object>()
    const active = new Map<Subtree, ItemPath>()

    const visit = (
      items: readonly Item[],
      parent?: ItemPath,
      owner?: Origin
    ): void => {
      for (const entry of plan(items)) {
        const [root, ...steps] = entry.path
        const path: ItemPath = parent
          ? [...parent, ['items', root], ...steps]
          : entry.path
        const item = entry.item
        if ('create' in item && active.has(item)) {
          const paths = [...active.values()]
          throw new DependencyCycleError([
            ...paths.slice(paths.indexOf(active.get(item)!)),
            path,
          ])
        }
        if (seen.has(item)) continue
        seen.add(item)
        if ('install' in item) {
          const origin = owner ?? {
            id: formatPath(path),
            path: formatPath(path),
          }
          item.install({
            origin,
            contribute: (facet, read) => {
              const cell = facet.cell(this)
              commits.add(cell.stage(commits, read))
              clears.add(cell.clear)
            },
          })
          continue
        }

        active.set(item, path)
        let mounted = this.mounted.get(item)
        if (!mounted) {
          const origin = { id: formatPath(path), path: formatPath(path) }
          const instance = item.create(createScope(origin, this))
          created.push(instance)
          mounted = {
            instance,
            children: Object.freeze([...instance.items]),
            origin,
          }
        }
        if (replacement?.subtree === item)
          mounted = { ...mounted, children: replacement.items }
        next.set(item, mounted)
        visit(mounted.children, path, mounted.origin)
        active.delete(item)
      }
    }

    try {
      this.acquiring = true
      try {
        visit(roots)
      } catch (error) {
        this.acquiring = false
        try {
          await release(created)
        } catch (cleanup) {
          throw new AggregateError(
            [error, cleanup],
            'Acquisition and rollback failed'
          )
        }
        throw error
      } finally {
        this.acquiring = false
      }

      const removed = [...this.mounted]
        .filter(([item]) => !next.has(item))
        .map(([, value]) => value.instance)
      // Publish only after every acquisition succeeds. Cleanup failures occur after
      // commit and cannot roll back resources that have already been released.
      this.roots = roots
      this.mounted = next
      const previousClears = this.clears
      this.clears = clears
      try {
        // `batch` defers observers until every Facet has its new sources, so a
        // computation reading several Facets cannot see a partially committed graph.
        batch(() => {
          for (const clear of previousClears) if (!clears.has(clear)) clear()
          for (const commit of commits) commit()
        })
      } finally {
        await release(removed)
      }
    } finally {
      this.busy = false
    }
  }
}

/** Reverse graph order releases children and consumers before their owners/dependencies. */
async function release(instances: readonly Instance[]): Promise<void> {
  const failures: unknown[] = []
  for (const instance of [...instances].reverse()) {
    try {
      await instance.dispose?.()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length)
    throw new AggregateError(failures, 'Subtree cleanup failed')
}
