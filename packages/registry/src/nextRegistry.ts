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
  Extension,
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
interface DebugItem {
  readonly kind: 'binding' | 'extension'
  readonly key: Key
  readonly origin: Origin
}

interface RegistryInspection {
  readonly extensions: number
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

/** `replace` changes `children` while retaining `instance` and its cleanup. */
interface Mounted {
  readonly definition: Extension
  readonly dependencies: ReadonlyMap<string, Mounted>
  readonly instance: Instance
  readonly exports: unknown
  readonly children: readonly Item[]
  readonly origin: Origin
}

/** Synchronous acquisition, atomic publication, and awaitable resource release. */
export class Registry implements ScopeHost {
  private roots: readonly Item[] = []
  private mounted = new Map<Key, Mounted>()
  private disposal: readonly Mounted[] = []
  private clears = new Set<() => void>()
  private phase: 'idle' | 'acquiring' | 'settling' | 'disposed' = 'idle'
  private combining = 0
  private shutdown?: Promise<void>
  private readonly graph = signal<readonly DebugItem[]>([])

  observe<I, O>(facet: Facet<I, O>): Signal<O> {
    const observation = computed(() => facet.cell(this).output.value)
    // A computed can return its cache without running its callback. Guard the
    // getter so even warmed observations reject reads during acquisition.
    return new Proxy(observation, {
      get: (target, property, receiver) => {
        if (property === 'value' && this.phase === 'acquiring')
          throw new Error('Defer observations until acquisition completes')
        return Reflect.get(target, property, receiver)
      },
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
      extensions: this.mounted.size,
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

  replace(extension: Extension, items: readonly Item[]): Promise<void> {
    this.assertMutable()
    return this.reconcile(this.roots, {
      extension,
      items: Object.freeze([...items]),
    })
  }

  private async reconcile(
    roots: readonly Item[],
    replacement?: { extension: Extension; items: readonly Item[] }
  ): Promise<void> {
    if (this.phase === 'disposed') throw new Error('Registry is disposed')
    if (this.phase !== 'idle')
      throw new Error('A reconciliation is already in progress')
    if (replacement && !this.mounted.has(itemKey(replacement.extension))) {
      throw new Error('Cannot replace an unmounted Extension')
    }
    this.phase = 'acquiring'
    const next = new Map<Key, Mounted>()
    // Facets capture their typed sources in commit closures. This registry can
    // publish different Facet input types together without reconstructing pairs.
    // A cell's stable `clear` callback identifies Facets removed by this change.
    const writes = new Map<() => void, () => void>()
    const registrations: { precedence: number; install: () => void }[] = []
    const debugItems: DebugItem[] = []
    const created = new Set<Instance>()
    let order: readonly Mounted[] = []
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
        const dependencies = new Map<string, Mounted>()
        for (const [name, dependency] of Object.entries(
          item.dependencies ?? {}
        )) {
          const acquired = next.get(itemKey(dependency))
          if (!acquired || acquired.definition !== dependency)
            throw new Error(
              `Dependency ${JSON.stringify(name)} does not match the selected Extension`
            )
          dependencies.set(name, acquired)
        }
        let mounted = this.mounted.get(key)
        if (
          mounted &&
          (mounted.dependencies.size !== dependencies.size ||
            [...dependencies].some(
              ([name, dependency]) =>
                mounted!.dependencies.get(name)?.instance !==
                dependency.instance
            ))
        )
          throw new Error(
            `Cannot change dependencies of retained Extension ${mounted.origin.id}`
          )
        if (!mounted) {
          const origin = originFor(key, path)
          const inputs = Object.freeze(
            Object.fromEntries(
              [...dependencies].map(([name, dependency]) => [
                name,
                dependency.exports,
              ])
            )
          )
          const instance = item.create(inputs, createScope(origin, this))
          mounted = {
            definition: item,
            dependencies,
            instance,
            exports: undefined,
            children: [],
            origin,
          }
          created.add(instance)
          next.set(key, mounted)
          mounted = {
            ...mounted,
            exports: instance.exports,
            children: Object.freeze([...(instance.items ?? [])]),
          }
        }
        if (replacement && itemKey(replacement.extension) === key)
          mounted = { ...mounted, children: replacement.items }
        next.set(key, mounted)
        debugItems.push({ kind: 'extension', key, origin: mounted.origin })
        visit(mounted.children, path, mounted.origin)
        active.delete(key)
      }
    }

    try {
      try {
        visit(roots)
        order = disposalOrder(next)
        for (const registration of registrations.sort(
          (a, b) => a.precedence - b.precedence
        ))
          registration.install()
      } catch (error) {
        this.phase = 'settling'
        // Failed child expansion may leave a cycle. Rollback still releases every
        // returned instance once, before another reconciliation can begin.
        return await release(
          disposalOrder(next, false)
            .filter((mounted) => created.has(mounted.instance))
            .map(({ instance }) => instance),
          {
            error,
            message: 'Acquisition and rollback failed',
          }
        )
      }
      this.phase = 'settling'

      const removed = this.disposal
        .filter((mounted) => !next.has(itemKey(mounted.definition)))
        .map(({ instance }) => instance)
      // Publish only after every acquisition succeeds. Cleanup failures occur after
      // commit and cannot roll back resources that have already been released.
      this.roots = roots
      this.mounted = next
      this.disposal = order
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

/** Dependency consumers and owned children release before the resources they need. */
function disposalOrder(
  mounted: ReadonlyMap<Key, Mounted>,
  strict = true
): readonly Mounted[] {
  const before = new Map<Key, Set<Key>>()
  const precedes = (first: Key, second: Key) => {
    let entries = before.get(second)
    if (!entries) before.set(second, (entries = new Set()))
    entries.add(first)
  }
  const children = (
    items: readonly Item[],
    owner: Key,
    groups = new Set<Item>()
  ): void => {
    for (const item of items) {
      if ('create' in item) precedes(itemKey(item), owner)
      else if (!('install' in item) && !groups.has(item)) {
        groups.add(item)
        children(item, owner, groups)
      }
    }
  }
  for (const [key, value] of mounted) {
    for (const dependency of value.dependencies.values())
      precedes(key, itemKey(dependency.definition))
    children(value.children, key)
  }
  const result: Mounted[] = []
  const complete = new Set<Key>()
  const active = new Set<Key>()
  const visit = (key: Key): void => {
    if (complete.has(key)) return
    if (active.has(key)) {
      if (strict) throw new Error('Cyclic Extension lifetimes')
      return
    }
    active.add(key)
    for (const prerequisite of before.get(key) ?? []) visit(prerequisite)
    active.delete(key)
    complete.add(key)
    const value = mounted.get(key)
    if (value) result.push(value)
  }
  for (const key of [...mounted.keys()].reverse()) visit(key)
  return result
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
  for (const instance of instances) {
    try {
      await instance.dispose?.()
    } catch (error) {
      failures.push(error)
    }
  }
  const cleanup = failures.length
    ? new AggregateError(failures, 'Extension cleanup failed')
    : undefined
  if (primary) {
    if (cleanup)
      throw new AggregateError([primary.error, cleanup], primary.message)
    throw primary.error
  }
  if (cleanup) throw cleanup
}
