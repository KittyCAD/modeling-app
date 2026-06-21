import type { ReadonlySignal as ReadonlyPreactSignal } from '@preact/signals-core'

/**
 * Precedence controls how multiple value-spec contributions are ordered before a
 * value spec's combine function runs.
 */
export type Precedence = 'highest' | 'high' | 'default' | 'low' | 'lowest'

/**
 * A small protocol for runtime-owned resources that need cleanup when a
 * registry item instance is removed or the registry is disposed.
 */
export interface DisposableLike {
  [Symbol.dispose](): void
}

export type RegistryItemLifecycleCleanup = DisposableLike | (() => void)

export type RegistryItemLifecycleHook =
  () => void | RegistryItemLifecycleCleanup

/**
 * Value-spec contributions may be static values or live reactive values.
 *
 * Registry value specs define composition. Preact signals define liveness.
 */
export type MaybeSignal<T> = T | ReadonlyPreactSignal<T>

/**
 * Stable identities are used for deduplication and runtime instance
 * preservation across reconfiguration.
 */
export type RegistryItemKey = object | string

/**
 * A ValueSpec is a typed registry point.
 *
 * Registry items contribute values into value specs. The registry gathers all active
 * contributions for a given value spec, orders them, and passes them through the
 * value spec's pure combine function to produce one resolved output.
 *
 * In this framework, value specs are the many-to-one composition layer.
 */
export interface ValueSpec<Input, Output> {
  readonly id: symbol
  readonly name: string
  readonly defaultValue: Output
  readonly combine: (inputs: readonly Input[]) => Output
}

/**
 * A Service is a named capability exposed by one registry item for other
 * registry items to consume.
 *
 * Services are the capability / dependency-injection layer. They usually wrap
 * stable objects whose fields may include readonly Preact signals and methods.
 */
export interface Service<_T> {
  readonly id: symbol
  readonly name: string
  readonly multiple: boolean
}

/**
 * A single value-spec contribution from a registry item.
 */
export interface ValueSpecContribution<Input> {
  readonly valueSpec: ValueSpec<Input, any>
  readonly value: MaybeSignal<Input>
  readonly precedence?: Precedence
  readonly key?: RegistryItemKey
}

/**
 * A single service contribution from a registry item.
 */
export interface ServiceContribution<T> {
  readonly service: Service<T>
  readonly implementation: T
}

/**
 * A declarative registry item definition.
 *
 * Registry items can contribute value specs, provide services, and nest other
 * registry items. They should remain declarative whenever possible.
 */
export interface RegistryItemDefinition {
  readonly id?: RegistryItemKey
  readonly provides?: readonly ValueSpecContribution<any>[]
  readonly providesServices?: readonly ServiceContribution<any>[]
  readonly uses?: readonly RegistryItem[]
}

/**
 * A runtime registry item may own cleanup logic in addition to declarative
 * contributions.
 */
export interface RuntimeRegistryItemDefinition extends RegistryItemDefinition {
  readonly activate?: RegistryItemLifecycleHook
  readonly dispose?: RegistryItemLifecycleCleanup
}

/**
 * A runtime registry item factory constructs long-lived registry item instances.
 *
 * Factories are where models usually live. A factory should create a stable
 * service surface and return a registry item definition that exposes it.
 */
export interface RuntimeRegistryItemHandle<TModel = unknown> {
  readonly model?: TModel
  readonly item: RuntimeRegistryItemDefinition
}

/**
 * A runtime registry item factory. The registry preserves instances by item key.
 */
export interface RegistryItemFactory<TModel = unknown> {
  (ctx: RegistryItemContext): RuntimeRegistryItemHandle<TModel>
  readonly itemKey?: RegistryItemKey
}

/**
 * The union of all supported registry nodes accepted by the registry.
 */
export type RegistryItem =
  | RegistryItemDefinition
  | RuntimeRegistryItemDefinition
  | RegistryItemFactory<any>
  | SlotInstance

/**
 * ValueSpecReader exposes resolved registry value-spec values either as snapshots or
 * live Preact signals.
 */
export interface ValueSpecReader {
  get<I, O>(valueSpec: ValueSpec<I, O>): O
  signal<I, O>(valueSpec: ValueSpec<I, O>): ReadonlyPreactSignal<O>
}

/**
 * ServiceReader exposes resolved services either as required, optional, or
 * debug-inspectable values.
 */
export interface ServiceReader {
  get<T>(service: Service<T>): T
  optional<T>(service: Service<T>): T | undefined
  signal<T>(service: Service<T>): ReadonlyPreactSignal<T | undefined>
  debugService<T>(
    service: Service<T>
  ): ReadonlyPreactSignal<readonly DebugServiceItem[]>
}

/**
 * Registry item factories receive a context that lets them read resolved value specs
 * and services lazily.
 */
export interface RegistryItemContext {
  readonly container: RegistryLike
  readonly valueSpecs: ValueSpecReader
  readonly services: ServiceReader
}

/**
 * Debug information for one value-spec contribution.
 */
export interface DebugValueSpecItem {
  readonly valueSpecName: string
  readonly sourcePath: string
  readonly precedence: Precedence
  readonly key?: RegistryItemKey
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
 * Slots let callers swap a subtree of registry items without rebuilding the
 * rest of the registry.
 */
export class Slot {
  readonly id = Symbol('Slot')

  of(...content: readonly RegistryItem[]): SlotInstance {
    return new SlotInstance(this, content)
  }
}

/**
 * Concrete content inserted into a slot.
 */
export class SlotInstance {
  constructor(
    readonly slot: Slot,
    readonly content: readonly RegistryItem[]
  ) {}
}

/**
 * Registry shape exposed to registry item factories through their context.
 *
 * The concrete implementation lives in registry.ts.
 */
export interface RegistryLike extends DisposableLike {
  get<T>(service: Service<T>): T
  get<I, O>(valueSpec: ValueSpec<I, O>): O
  signal<T>(service: Service<T>): ReadonlyPreactSignal<T | undefined>
  signal<I, O>(valueSpec: ValueSpec<I, O>): ReadonlyPreactSignal<O>
  reconfigure(slot: Slot, items: readonly RegistryItem[]): void
  optional<T>(service: Service<T>): T | undefined
  debugService<T>(
    service: Service<T>
  ): ReadonlyPreactSignal<readonly DebugServiceItem[]>
}
