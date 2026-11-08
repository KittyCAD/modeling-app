import { computed, type ReadonlySignal, signal } from '@preact/signals-core'

/** A live observation. Preact supplies dependency tracking and writable signals. */
export type Signal<T> = ReadonlySignal<T>

/** Explicit reads admit constants and signals without inspecting value shapes. */
export type Source<T> = () => T

/** One `Facet`'s output and write operations for a single registry. */
interface FacetCell<I, O> {
  readonly output: Signal<O>
  readonly clear: () => void
  readonly stage: (transaction: object, read: Source<I>) => () => void
}

/** Many ordered inputs become one output; `combine([])` defines the empty case. */
export class Facet<Input, Output> {
  readonly kind = 'facet'
  private readonly cells = new WeakMap<object, FacetCell<Input, Output>>()

  constructor(
    readonly name: string,
    readonly combine: (inputs: readonly Input[]) => Output
  ) {}

  /** @internal Reuse this registry's output and stage writes to its typed source list. */
  cell(registry: object): FacetCell<Input, Output> {
    const existing = this.cells.get(registry)
    if (existing) return existing
    const sources = signal<readonly Source<Input>[]>([])
    const pending = new WeakMap<
      object,
      { reads: Source<Input>[]; commit: () => void }
    >()
    const cell: FacetCell<Input, Output> = {
      output: computed(() => this.combine(sources.value.map((read) => read()))),
      clear: () => {
        sources.value = []
      },
      stage: (transaction, read) => {
        let draft = pending.get(transaction)
        if (!draft) {
          const reads: Source<Input>[] = []
          draft = {
            reads,
            commit: () => {
              pending.delete(transaction)
              sources.value = reads
            },
          }
          pending.set(transaction, draft)
        }
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
export type Service<T extends object> = Facet<Provider<T>, Resolution<T>>

/** Adapter types derive from contract tokens rather than repeating domain shapes. */
export type InputOf<F> = F extends Facet<infer I, infer _O> ? I : never
export type OutputOf<F> = F extends Facet<infer _I, infer O> ? O : never
export type CapabilityOf<S> = S extends Service<infer T> ? T : never

export function service<T extends object>(name: string): Service<T> {
  return new Facet(name, (providers) => {
    const [first, second, ...rest] = providers
    if (!first) return { kind: 'missing' }
    if (!second) return { kind: 'ready', value: first.value }
    return { kind: 'conflict', providers: [first, second, ...rest] }
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
  contribute<I, O>(facet: Facet<I, O>, source: Source<NoInfer<I>>): void
}

export interface Binding {
  readonly install: (sink: Sink) => void
}

export function contribute<I, O>(
  facet: Facet<I, O>,
  source: Source<NoInfer<I>>
): Binding {
  return { install: (sink) => sink.contribute(facet, source) }
}

export function provide<T extends object>(
  token: Service<T>,
  value: NoInfer<T>
): Binding {
  return {
    install: (sink) => {
      const { id, path } = sink.origin
      sink.contribute(token, () => ({ id, path, value }))
    },
  }
}

/** The graph consists of contributions, groups, and owned subtrees. */
export type Item = Binding | readonly Item[] | Subtree

/** A slot acquires a snapshot of supplied children, with no resources of its own. */
export function slot(items: readonly Item[] = []): Subtree {
  const initial = Object.freeze([...items])
  return { create: () => ({ items: initial }) }
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
