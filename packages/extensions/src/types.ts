import type { ReadonlySignal } from '@preact/signals-core'

/**
 * Precedence controls how multiple signal contributions are ordered before a
 * signal's combine function runs.
 */
export type Precedence = 'highest' | 'high' | 'default' | 'low' | 'lowest'

/**
 * A small protocol for runtime-owned resources that need cleanup when an
 * extension instance is removed or the container is disposed.
 */
export interface DisposableLike {
  [Symbol.dispose](): void
}

/**
 * Signal contributions may be static values or live reactive values.
 *
 * Extension signals define composition. Preact signals define liveness.
 */
export type MaybeSignal<T> = T | ReadonlySignal<T>

/**
 * Stable identities are used for deduplication and runtime instance
 * preservation across reconfiguration.
 */
export type ExtensionKey = object | string

/**
 * A Signal is a typed extension point.
 *
 * Extensions contribute values into signals. The container gathers all active
 * contributions for a given signal, orders them, and passes them through the
 * signal's pure combine function to produce one resolved output.
 *
 * In this framework, signals are the many-to-one composition layer.
 */
export interface Signal<Input, Output> {
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
 * A single signal contribution from an extension.
 */
export interface SignalContribution<Input> {
  readonly signal: Signal<Input, any>
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
 * Extensions can contribute signals, provide services, and nest other
 * extensions. They should remain declarative whenever possible.
 */
export interface ExtensionDefinition {
  readonly id?: ExtensionKey
  readonly provides?: readonly SignalContribution<any>[]
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
 * A runtime extension factory. The container preserves instances by extension key.
 */
export interface ExtensionFactory<TModel = unknown> {
  (ctx: ExtensionContext): RuntimeExtensionHandle<TModel>
  readonly extensionKey?: ExtensionKey
}

/**
 * The union of all supported extension nodes accepted by the container.
 */
export type ExtensionNode =
  | ExtensionDefinition
  | RuntimeExtensionDefinition
  | ExtensionFactory<any>
  | SlotInstance

/**
 * SignalReader exposes resolved extension-signal values either as snapshots or
 * live Preact signals.
 */
export interface SignalReader {
  get<I, O>(signal: Signal<I, O>): O
  signal<I, O>(signal: Signal<I, O>): ReadonlySignal<O>
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
 * Extension factories receive a context that lets them read resolved signals
 * and services lazily.
 */
export interface ExtensionContext {
  readonly container: ExtensionContainerLike
  readonly signals: SignalReader
  readonly services: ServiceReader
}

/**
 * Debug information for one signal contribution.
 */
export interface DebugSignalItem {
  readonly signalName: string
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
 * Slots let callers swap a subtree of extensions without rebuilding the
 * rest of the container.
 */
export class Slot {
  readonly id = Symbol('Slot')

  of(...content: readonly ExtensionNode[]): SlotInstance {
    return new SlotInstance(this, content)
  }
}

/**
 * Concrete content inserted into a slot.
 */
export class SlotInstance {
  constructor(
    readonly slot: Slot,
    readonly content: readonly ExtensionNode[]
  ) {}
}

/**
 * Container shape exposed to extension factories through their context.
 *
 * The concrete implementation lives in container.ts.
 */
export interface ExtensionContainerLike extends DisposableLike {
  get<T>(service: Service<T>): T
  get<I, O>(signal: Signal<I, O>): O
  signal<T>(service: Service<T>): ReadonlySignal<T | undefined>
  signal<I, O>(signal: Signal<I, O>): ReadonlySignal<O>
  reconfigure(slot: Slot, extensions: readonly ExtensionNode[]): void
  optional<T>(service: Service<T>): T | undefined
  debugService<T>(
    service: Service<T>
  ): ReadonlySignal<readonly DebugServiceItem[]>
}
