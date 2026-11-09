import { batch, computed, signal } from '@preact/signals-core'
import type {
  ContributionInfo,
  Facet,
  Instance,
  Item,
  Key,
  Origin,
  ScopeHost,
  Service,
  Signal,
  Subtree,
} from './algebra'
import {
  createScope,
  itemKey,
  optional,
  precedenceRank,
  required,
} from './algebra'
import { formatPath, type ItemPath } from './path'
import { DependencyCycleError, plan } from './planner'

/** One selected graph occurrence; keys and acquisition origins survive reconfiguration. */
export interface DebugItem {
  readonly kind: 'binding' | 'subtree'
  readonly key: Key
  readonly origin: Origin
}

export interface RegistryInspection {
  readonly subtrees: number
  readonly bindings: number
  readonly facets: number
  readonly items: readonly DebugItem[]
}

function originFor(key: Key, path: ItemPath): Origin {
  const location = formatPath(path)
  return {
    id:
      typeof key === 'string'
        ? key
        : typeof key === 'symbol'
          ? (key.description ?? location)
          : location,
    path: location,
  }
}

/** Retained ownership is separate from replaceable children and their bindings. */
interface Mounted {
  readonly instance: Instance
  readonly children: readonly Item[]
  readonly origin: Origin
}

/** Synchronous acquisition, atomic publication, and awaitable resource release. */
export class Registry implements ScopeHost {
  private roots: readonly Item[] = []
  private mounted = new Map<Key, Mounted>()
  private clears = new Set<() => void>()
  private phase: 'idle' | 'acquiring' | 'settling' | 'disposed' = 'idle'
  private combining = 0
  private shutdown?: Promise<void>
  private readonly graph = signal<readonly DebugItem[]>([])

  observe<I, O>(facet: Facet<I, O>): Signal<O> {
    return computed(() => {
      if (this.phase === 'acquiring')
        throw new Error('Defer observations until acquisition completes')
      return facet.cell(this).output.value
    })
  }

  get<I, O>(facet: Facet<I, O>): O {
    return this.observe(facet).value
  }
  required<T extends object>(token: Service<T>): T {
    return required(token, this.get(token))
  }
  optional<T extends object>(token: Service<T>): T | undefined {
    return optional(token, this.get(token))
  }
  debug<I, O>(facet: Facet<I, O>): Signal<readonly ContributionInfo[]> {
    return facet.cell(this).debug
  }

  inspect(): RegistryInspection {
    const items = this.graph.value
    return {
      subtrees: this.mounted.size,
      bindings: items.filter((item) => item.kind === 'binding').length,
      facets: this.clears.size,
      items,
    }
  }

  /** @internal Evaluate sources and `combine` while guarding mutations and service calls. */
  compute<T>(read: () => T): T {
    if (this.phase === 'acquiring')
      throw new Error('Defer observations until acquisition completes')
    this.combining++
    try {
      return read()
    } finally {
      this.combining--
    }
  }

  /** @internal Called by service facades and mutation methods before changing state. */
  assertMutable(): void {
    if (this.combining) throw new Error('Cannot mutate while combining a Facet')
  }

  dispose(): Promise<void> {
    this.assertMutable()
    if (this.shutdown) return this.shutdown
    if (this.phase !== 'idle')
      return Promise.reject(
        new Error('A reconciliation is already in progress')
      )
    this.shutdown = this.reconcile([]).finally(() => {
      this.phase = 'disposed'
    })
    return this.shutdown
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose()
  }

  configure(items: readonly Item[]): Promise<void> {
    this.assertMutable()
    return this.reconcile(Object.freeze([...items]))
  }

  replace(subtree: Subtree, items: readonly Item[]): Promise<void> {
    this.assertMutable()
    return this.reconcile(this.roots, {
      subtree,
      items: Object.freeze([...items]),
    })
  }

  private async reconcile(
    roots: readonly Item[],
    replacement?: { subtree: Subtree; items: readonly Item[] }
  ): Promise<void> {
    if (this.phase === 'disposed') throw new Error('Registry is disposed')
    if (this.phase !== 'idle')
      throw new Error('A reconciliation is already in progress')
    if (replacement && !this.mounted.has(itemKey(replacement.subtree))) {
      throw new Error('Cannot replace an unmounted subtree')
    }
    this.phase = 'acquiring'
    const next = new Map<Key, Mounted>()
    // Pair each cell's stable `clear` callback with the commit for this attempt.
    const writes = new Map<() => void, () => void>()
    const registrations: { precedence: number; install: () => void }[] = []
    const debugItems: DebugItem[] = []
    const created: Instance[] = []
    const seen = new Set<Key>()
    const selected = new Map<Key, Item>()
    const active = new Map<Key, ItemPath>()

    const visit = (
      items: readonly Item[],
      parent?: ItemPath,
      owner?: Origin
    ): void => {
      const entries = plan(items, selected)
      // Declared definitions are selected before `create` reveals any children.
      // Later plans must discard losing definitions before expanding dependencies.
      for (const entry of entries) selected.set(itemKey(entry.item), entry.item)
      for (const entry of entries) {
        const [root, ...steps] = entry.path
        const path: ItemPath = parent
          ? [...parent, ['items', root], ...steps]
          : entry.path
        const item = entry.item
        const key = itemKey(item)
        if ('create' in item && active.has(key)) {
          const paths = [...active.values()]
          throw new DependencyCycleError([
            ...paths.slice(paths.indexOf(active.get(key)!)),
            path,
          ])
        }
        if (seen.has(key)) continue
        seen.add(key)
        if ('install' in item) {
          const origin = owner ?? originFor(key, path)
          const info: ContributionInfo = {
            origin,
            precedence: item.precedence ?? 'default',
            key: item.key,
          }
          debugItems.push({ kind: 'binding', key, origin })
          item.install({
            origin,
            runtime: this,
            contribute: (facet, read) => {
              registrations.push({
                precedence: precedenceRank[info.precedence],
                install: () => {
                  const cell = facet.cell(this)
                  const commit = cell.stage(writes, read, info)
                  if (commit) writes.set(cell.clear, commit)
                },
              })
            },
          })
          continue
        }

        active.set(key, path)
        let mounted = this.mounted.get(key)
        if (!mounted) {
          const origin = originFor(key, path)
          const instance = item.create(createScope(origin, this))
          created.push(instance)
          mounted = {
            instance,
            children: Object.freeze([...instance.items]),
            origin,
          }
        }
        if (replacement && itemKey(replacement.subtree) === key)
          mounted = { ...mounted, children: replacement.items }
        next.set(key, mounted)
        debugItems.push({ kind: 'subtree', key, origin: mounted.origin })
        visit(mounted.children, path, mounted.origin)
        active.delete(key)
      }
    }

    try {
      try {
        visit(roots)
        for (const registration of registrations.sort(
          (a, b) => a.precedence - b.precedence
        ))
          registration.install()
      } catch (error) {
        this.phase = 'settling'
        // Await rollback before `finally` allows another reconciliation.
        return await release(created, {
          error,
          message: 'Acquisition and rollback failed',
        })
      }
      this.phase = 'settling'

      const removed = [...this.mounted]
        .filter(([item]) => !next.has(item))
        .map(([, value]) => value.instance)
      // Publish only after every acquisition succeeds. Cleanup failures occur after
      // commit and cannot roll back resources that have already been released.
      this.roots = roots
      this.mounted = next
      const previousClears = this.clears
      this.clears = new Set(writes.keys())
      let failure: { error: unknown; message: string } | undefined
      try {
        // `batch` defers observers until every Facet has its new sources, so a
        // computation reading several Facets cannot see a partially committed graph.
        batch(() => {
          for (const clear of previousClears) if (!writes.has(clear)) clear()
          for (const commit of writes.values()) commit()
          this.graph.value = Object.freeze(debugItems)
        })
      } catch (error) {
        failure = { error, message: 'Publication and cleanup failed' }
      }
      await release(removed, failure)
    } finally {
      this.phase = 'idle'
    }
  }
}

/**
 * Release children/consumers before owners/dependencies. Preserve an earlier
 * acquisition or publication failure alongside any cleanup failures.
 */
async function release(
  instances: readonly Instance[],
  primary?: { error: unknown; message: string }
): Promise<void> {
  const failures: unknown[] = []
  for (const instance of [...instances].reverse()) {
    try {
      await instance.dispose?.()
    } catch (error) {
      failures.push(error)
    }
  }
  const cleanup = failures.length
    ? new AggregateError(failures, 'Subtree cleanup failed')
    : undefined
  if (primary) {
    if (cleanup)
      throw new AggregateError([primary.error, cleanup], primary.message)
    throw primary.error
  }
  if (cleanup) throw cleanup
}
