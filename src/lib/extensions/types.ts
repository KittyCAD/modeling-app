import type { ReadonlySignal } from '@preact/signals-core'

/**
 * Precedence controls how multiple facet contributions are ordered before a
 * facet's combine function runs.
 */
export type Precedence = 'highest' | 'high' | 'default' | 'low' | 'lowest'

/**
 * A small protocol for runtime-owned resources that need cleanup when an
 * extension instance is removed or the host is disposed.
 */
export interface DisposableLike {
  [Symbol.dispose](): void
}

/**
 * Facet contributions may be static values or live reactive values.
 *
 * Facets define composition. Signals define liveness.
 */
export type MaybeSignal<T> = T | ReadonlySignal<T>

/**
 * Stable identities are used for deduplication and runtime instance
 * preservation across reconfiguration.
 */
export type ExtensionKey = object | string

/**
 * A Facet is a typed extension point.
 *
 * Extensions contribute values into facets. The host gathers all active
 * contributions for a given facet, orders them, and passes them through the
 * facet's pure combine function to produce one resolved output.
 *
 * In this framework, facets are the many-to-one composition layer.
 */
export interface Facet<Input, Output> {
  readonly id: symbol
  readonly name: string
  readonly defaultValue: Output
  readonly combine: (inputs: readonly Input[]) => Output
}

/**
 * A Service is a named capability exposed by one extension for other
 * extensions to consume.
 *
 * Services are the capability / dependency-injection layer. They usually wrap
 * stable objects whose fields may include readonly signals and methods.
 */
export interface Service<_T> {
  readonly id: symbol
  readonly name: string
  readonly multiple: boolean
}

/**
 * A single facet contribution from an extension.
 */
export interface FacetContribution<Input> {
  readonly facet: Facet<Input, any>
  readonly value: MaybeSignal<Input>
  readonly precedence?: Precedence
  readonly key?: ExtensionKey
}

/**
 * A single service contribution from an extension.
 */
export interface ServiceContribution<T> {
  readonly service: Service<T>
  readonly implementation: T
}

/**
 * A declarative extension definition.
 *
 * Extensions can contribute facets, provide services, and nest other
 * extensions. They should remain declarative whenever possible.
 */
export interface ExtensionDefinition {
  readonly id?: ExtensionKey
  readonly provides?: readonly FacetContribution<any>[]
  readonly providesServices?: readonly ServiceContribution<any>[]
  readonly uses?: readonly ExtensionNode[]
}

/**
 * A runtime extension may own cleanup logic in addition to declarative
 * contributions.
 */
export interface RuntimeExtensionDefinition extends ExtensionDefinition {
  readonly dispose?: DisposableLike | (() => void)
}

/**
 * A runtime extension factory constructs long-lived extension instances.
 *
 * Factories are where models usually live. A factory should create a stable
 * service surface and return an extension definition that exposes it.
 */
export interface RuntimeExtensionHandle<TModel = unknown> {
  readonly model?: TModel
  readonly extension: RuntimeExtensionDefinition
}

/**
 * A runtime extension factory. The host preserves instances by extension key.
 */
export interface ExtensionFactory<TModel = unknown> {
  (ctx: ExtensionContext): RuntimeExtensionHandle<TModel>
  readonly extensionKey?: ExtensionKey
}

/**
 * The union of all supported extension nodes accepted by the host.
 */
export type ExtensionNode =
  | ExtensionDefinition
  | RuntimeExtensionDefinition
  | ExtensionFactory<any>
  | CompartmentInstance

/**
 * FacetReader exposes resolved facet values either as snapshots or live
 * signals.
 */
export interface FacetReader {
  get<I, O>(facet: Facet<I, O>): O
  signal<I, O>(facet: Facet<I, O>): ReadonlySignal<O>
}

/**
 * ServiceReader exposes resolved services either as required, optional, or
 * debug-inspectable values.
 */
export interface ServiceReader {
  get<T>(service: Service<T>): T
  optional<T>(service: Service<T>): T | undefined
  signal<T>(service: Service<T>): ReadonlySignal<T | undefined>
  debugService<T>(
    service: Service<T>
  ): ReadonlySignal<readonly DebugServiceItem[]>
}

/**
 * Extension factories receive a context that lets them read resolved facets and
 * services lazily.
 */
export interface ExtensionContext {
  readonly host: ExtensionHostLike
  readonly facets: FacetReader
  readonly services: ServiceReader
}

/**
 * Debug information for one facet contribution.
 */
export interface DebugFacetItem {
  readonly facetName: string
  readonly sourcePath: string
  readonly precedence: Precedence
  readonly key?: ExtensionKey
  readonly reactive: boolean
}

/**
 * Debug information for one service provider.
 */
export interface DebugServiceItem {
  readonly serviceName: string
  readonly sourcePath: string
  readonly multiple: boolean
}

/**
 * Compartments let callers swap a subtree of extensions without rebuilding the
 * rest of the host.
 */
export class Compartment {
  readonly id = Symbol('Compartment')

  of(...content: readonly ExtensionNode[]): CompartmentInstance {
    return new CompartmentInstance(this, content)
  }
}

/**
 * Concrete content inserted into a compartment.
 */
export class CompartmentInstance {
  constructor(
    readonly compartment: Compartment,
    readonly content: readonly ExtensionNode[]
  ) {}
}

/**
 * Host shape exposed to extension factories through their context.
 *
 * The concrete implementation lives in host.ts.
 */
export interface ExtensionHostLike extends DisposableLike {
  get<T>(service: Service<T>): T
  get<I, O>(facet: Facet<I, O>): O
  signal<T>(service: Service<T>): ReadonlySignal<T | undefined>
  signal<I, O>(facet: Facet<I, O>): ReadonlySignal<O>
  optional<T>(service: Service<T>): T | undefined
  debugService<T>(
    service: Service<T>
  ): ReadonlySignal<readonly DebugServiceItem[]>
}
