import { computed, type ReadonlySignal, signal } from '@preact/signals-core'
import { protect } from './protection'

/** A live observation. Preact supplies dependency tracking and writable signals. */
export type Signal<T> = ReadonlySignal<T>

/** Explicit reads admit constants and signals without inspecting value shapes. */
export type Source<T> = () => T

/** Stable Subtree identities and facet-scoped contribution identities. */
export type Key = object | string | symbol
export type Precedence = 'highest' | 'high' | 'default' | 'low' | 'lowest'
export const precedenceRank: Record<Precedence, number> = {
  highest: 0,
  high: 1,
  default: 2,
  low: 3,
  lowest: 4,
}

/** Where an effective contribution came from, in its resolved order. */
export interface ContributionInfo {
  readonly origin: Origin
  readonly precedence: Precedence
  readonly key?: Key
}

/** The registry evaluates pure reads and guards calls through service facades. */
interface CellRegistry {
  compute<T>(read: () => T): T
  assertMutable(): void
}

/** One `Facet`'s output and write operations for a single registry. */
interface FacetCell<I, O> {
  readonly output: Signal<O>
  readonly clear: () => void
  readonly debug: Signal<readonly ContributionInfo[]>
  readonly stage: (
    transaction: object,
    read: Source<I>,
    info: ContributionInfo
  ) => (() => void) | undefined
}

/** Many ordered inputs become one output; `combine([])` defines the empty case. */
export class Facet<Input, Output> {
  private readonly cells = new WeakMap<CellRegistry, FacetCell<Input, Output>>()

  constructor(
    readonly name: string,
    readonly combine: (inputs: readonly Input[]) => Output
  ) {}

  /** @internal Reuse this registry's output and stage writes to its typed source list. */
  cell(registry: CellRegistry): FacetCell<Input, Output> {
    const existing = this.cells.get(registry)
    if (existing) return existing
    const sources = signal<readonly Source<Input>[]>([])
    const debug = signal<readonly ContributionInfo[]>([])
    const pending = new WeakMap<
      object,
      {
        reads: Source<Input>[]
        info: ContributionInfo[]
        keys: Set<Key>
        commit: () => void
      }
    >()
    const cell: FacetCell<Input, Output> = {
      output: computed(() =>
        registry.compute(() =>
          this.combine(sources.value.map((read) => read()))
        )
      ),
      debug,
      clear: () => {
        sources.value = []
        debug.value = []
      },
      stage: (transaction, read, info) => {
        let draft = pending.get(transaction)
        if (!draft) {
          const reads: Source<Input>[] = []
          const metadata: ContributionInfo[] = []
          draft = {
            reads,
            info: metadata,
            keys: new Set(),
            commit: () => {
              pending.delete(transaction)
              sources.value = reads
              debug.value = metadata
            },
          }
          pending.set(transaction, draft)
        }
        if (info.key !== undefined) {
          if (draft.keys.has(info.key)) return undefined
          draft.keys.add(info.key)
        }
        draft.info.push(info)
        draft.reads.push(read)
        return draft.commit
      },
    }
    this.cells.set(registry, cell)
    return cell
  }
}

/** Interpreter-assigned ownership: a readable item ID and its location in the graph. */
export interface Origin {
  readonly id: string
  readonly path: string
}

/** Provider provenance survives composition so conflicts identify their sources. */
export interface Provider<T> extends Origin {
  readonly value: T
}

/** Cardinality is explicit; absence and conflict never silently choose a winner. */
export type Resolution<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'ready'; readonly value: T }
  | {
      readonly kind: 'conflict'
      readonly providers: readonly [Provider<T>, Provider<T>, ...Provider<T>[]]
    }

/** A service is a facet whose composition requires exactly one provider. */
const serviceSurface = Symbol('serviceSurface')
export type Service<T extends object> = Facet<Provider<T>, Resolution<T>> & {
  readonly [serviceSurface]: (registry: CellRegistry, value: T) => T
}

/** Adapter types derive from contract tokens rather than repeating domain shapes. */
export type InputOf<F> = F extends Facet<infer I, infer _O> ? I : never
export type OutputOf<F> = F extends Facet<infer _I, infer O> ? O : never
export type CapabilityOf<S> = S extends Service<infer T> ? T : never

export function service<T extends object>(name: string): Service<T> {
  const surfaces = new WeakMap<CellRegistry, WeakMap<T, T>>()
  const facet = new Facet<Provider<T>, Resolution<T>>(name, (providers) => {
    const [first, second, ...rest] = providers
    if (!first) return { kind: 'missing' }
    if (!second) return { kind: 'ready', value: first.value }
    return { kind: 'conflict', providers: [first, second, ...rest] }
  })
  return Object.assign(facet, {
    [serviceSurface]: (registry: CellRegistry, value: T): T => {
      let cache = surfaces.get(registry)
      if (!cache) {
        cache = new WeakMap<T, T>()
        surfaces.set(registry, cache)
      }
      let surface = cache.get(value)
      if (!surface) {
        surface = protect(value, () => registry.assertMutable())
        cache.set(value, surface)
      }
      return surface
    },
  })
}

/** Both a readable diagnostic and structured provider details for developer tools. */
export class ServiceResolutionError extends Error {
  constructor(
    readonly serviceName: string,
    readonly providers: readonly Provider<object>[]
  ) {
    super(
      `${serviceName}: expected one provider, received ${providers.length}` +
        (providers.length
          ? `; providers: ${providers
              .map(
                ({ id, path }) =>
                  `${JSON.stringify(id)} at ${JSON.stringify(path)}`
              )
              .join(', ')}`
          : '')
    )
    this.name = 'ServiceResolutionError'
  }
}

export function required<T extends object>(
  token: Service<T>,
  resolution: Resolution<NoInfer<T>>
): T {
  if (resolution.kind === 'ready') return resolution.value
  throw new ServiceResolutionError(
    token.name,
    resolution.kind === 'conflict' ? resolution.providers : []
  )
}

export function optional<T extends object>(
  token: Service<T>,
  resolution: Resolution<NoInfer<T>>
): T | undefined {
  return resolution.kind === 'missing' ? undefined : required(token, resolution)
}

/** A shared vocabulary. `satisfies Contract` preserves each token's own types. */
export type Contract = Readonly<Record<string, Facet<never, unknown>>>

/** Type-check each contribution before packaging it into a heterogeneous graph. */
export interface Sink {
  readonly origin: Origin
  readonly runtime?: CellRegistry
  contribute<I, O>(facet: Facet<I, O>, source: Source<NoInfer<I>>): void
}

export interface ContributionOptions {
  readonly key?: Key
  readonly precedence?: Precedence
}

export interface Binding extends ContributionOptions {
  readonly install: (sink: Sink) => void
}

export function contribute<I, O>(
  facet: Facet<I, O>,
  source: Source<NoInfer<I>>,
  options: ContributionOptions = {}
): Binding {
  return { ...options, install: (sink) => sink.contribute(facet, source) }
}

export function provide<T extends object>(
  token: Service<T>,
  value: NoInfer<T>,
  options: ContributionOptions = {}
): Binding {
  return {
    ...options,
    install: (sink) => {
      const { id, path } = sink.origin
      const surface = sink.runtime
        ? token[serviceSurface](sink.runtime, value)
        : value
      sink.contribute(token, () => ({ id, path, value: surface }))
    },
  }
}

/** The graph consists of contributions, groups, and owned subtrees. */
export type Item = Binding | readonly Item[] | Subtree

/** A slot acquires a snapshot of supplied children, with no resources of its own. */
export function slot(items: readonly Item[] = [], key?: Key): Subtree {
  const initial = Object.freeze([...items])
  return { key, create: () => ({ items: initial }) }
}

export type Cleanup = () => void | PromiseLike<void>

/** Initial children and owner cleanup; replacing children retains this instance. */
export interface Instance {
  readonly items: readonly Item[]
  readonly dispose?: Cleanup
}

/**
 * One owned lifetime. Identity is the object; dependencies remain required while
 * mounted. Acquisition reveals children, so planning must never call create.
 * Replacement reconciles children without reacquiring or disposing their owner.
 */
export interface Subtree {
  readonly key?: Key
  readonly create: (scope: Scope) => Instance
  readonly dependencies?: readonly Item[]
}

/** Interpreter operations, independent of any particular subtree's ownership. */
export interface ScopeHost {
  observe<I, O>(facet: Facet<I, O>): Signal<O>
  /** Replace children only; release owner resources after its children on unmount. */
  replace(subtree: Subtree, items: readonly Item[]): Promise<void>
}

/** Owner-local authoring conveniences, derived from observation and ownership. */
export interface Scope extends ScopeHost {
  readonly origin: Origin
  required<T extends object>(token: Service<T>): T
  optional<T extends object>(token: Service<T>): T | undefined
}

export function createScope(origin: Origin, host: ScopeHost): Scope {
  return {
    origin: Object.freeze({ ...origin }),
    observe: (facet) => host.observe(facet),
    replace: (subtree, items) => host.replace(subtree, items),
    required: (token) => required(token, host.observe(token).value),
    optional: (token) => optional(token, host.observe(token).value),
  }
}

/** A readonly contract snapshot, with precise token types retained. */
export function contract<const T extends Contract>(tokens: T): Readonly<T> {
  return Object.freeze({ ...tokens })
}

/** Binding keys belong to a Facet; Subtree keys identify mounted owners. */
export function itemKey(item: Item): Key {
  return 'create' in item ? (item.key ?? item) : item
}
