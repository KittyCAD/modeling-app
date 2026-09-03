import {
  type Signal as PreactSignal,
  type ReadonlySignal,
  computed,
  signal,
} from '@preact/signals-core'
import {
  MissingServiceError,
  ReconfigurationError,
  ServiceConflictError,
  ServiceResolutionError,
} from './errors'
import {
  dedupeContributions,
  isReadonlySignal,
  normalizeDisposer,
  sanitizeServiceImplementation,
  sortContributions,
  unwrapMaybeSignal,
} from './helpers'
import type {
  DebugServiceItem,
  DebugValueSpecItem,
  Precedence,
  RegistryItem,
  RegistryItemContext,
  RegistryItemFactory,
  RegistryItemKey,
  RuntimeRegistryItemHandle,
  Service,
  ServiceReader,
  Slot,
  ValueSpec,
  ValueSpecReader,
} from './types'
import { SlotInstance } from './types'

interface FlattenedContribution {
  readonly valueSpec: ValueSpec<unknown, unknown>
  readonly value: unknown
  readonly precedence: Precedence
  readonly key?: RegistryItemKey
  readonly order: number
  readonly sourcePath: string
}

interface FlattenedServiceContribution {
  readonly service: Service<unknown>
  readonly implementation: unknown
  readonly sourcePath: string
}

interface RuntimeInstance {
  readonly key: RegistryItemKey
  readonly handle: RuntimeRegistryItemHandle<unknown>
  readonly dispose?: () => unknown
}

interface FlattenResult {
  readonly contributions: readonly FlattenedContribution[]
  readonly serviceContributions: readonly FlattenedServiceContribution[]
  readonly slots: ReadonlyMap<symbol, readonly RegistryItem[]>
}

function isServiceDefinition(
  arg: Service<unknown> | ValueSpec<unknown, unknown>
): arg is Service<unknown> {
  return 'multiple' in arg
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

/**
 * Registry resolves registry item graphs into live value specs and services.
 *
 * Conceptually:
 * - value specs are the composition layer
 * - services are the capability layer
 * - Preact signals are the reactivity layer
 * - runtime factories / models are the lifecycle layer
 */
export class Registry implements ValueSpecReader, ServiceReader {
  private readonly roots = signal<readonly RegistryItem[]>([])
  private readonly slotContent = new Map<
    symbol,
    PreactSignal<readonly RegistryItem[]>
  >()
  private readonly registryValueSpecSignals = new Map<
    symbol,
    ReadonlySignal<unknown>
  >()
  private readonly debugValueSpecItems = new Map<
    symbol,
    ReadonlySignal<readonly DebugValueSpecItem[]>
  >()
  private readonly serviceSignals = new Map<symbol, ReadonlySignal<unknown>>()
  private readonly debugServiceItems = new Map<
    symbol,
    ReadonlySignal<readonly DebugServiceItem[]>
  >()
  private readonly runtimeInstances = new Map<
    RegistryItemKey,
    RuntimeInstance
  >()
  private readonly resolvingServices = new Set<symbol>()
  private readonly pendingDisposals = new Set<Promise<void>>()
  private latestReconciliation: Promise<void> = Promise.resolve()
  private shutdownPromise: Promise<void> | undefined

  private combineDepth = 0
  private flattenDepth = 0

  private readonly flat = computed<FlattenResult>(() => {
    this.flattenDepth++

    try {
      const contributions: FlattenedContribution[] = []
      const serviceContributions: FlattenedServiceContribution[] = []
      const slots = new Map<symbol, readonly RegistryItem[]>()
      const runtimeKeys = new Set<RegistryItemKey>()
      const seenItems = new Set<RegistryItemKey>()
      let order = 0

      const ctx: RegistryItemContext = {
        container: this,
        valueSpecs: this,
        services: this,
      }

      const visit = (node: RegistryItem, path: string): void => {
        if (node instanceof SlotInstance) {
          slots.set(node.slot.id, node.content)

          let holder = this.slotContent.get(node.slot.id)
          if (!holder) {
            holder = signal(node.content)
            this.slotContent.set(node.slot.id, holder)
          }

          for (const child of holder.value) {
            visit(child, `${path}/slot`)
          }
          return
        }

        if (typeof node === 'function') {
          const key = node.itemKey ?? node
          const runtime = this.ensureRuntimeInstance(key, node, ctx)
          runtimeKeys.add(key)
          visit(runtime.handle.item, `${path}/factory`)
          return
        }

        if (node.id != null) {
          if (seenItems.has(node.id)) return
          seenItems.add(node.id)
        }

        for (const contribution of node.provides ?? []) {
          contributions.push({
            valueSpec: contribution.valueSpec,
            value: contribution.value,
            precedence: contribution.precedence ?? 'default',
            key: contribution.key,
            order: order++,
            sourcePath: path,
          })
        }

        for (const service of node.providesServices ?? []) {
          serviceContributions.push({
            service: service.service,
            implementation: service.implementation,
            sourcePath: path,
          })
        }

        for (let index = 0; index < (node.uses?.length ?? 0); index++) {
          visit(node.uses![index], `${path}/uses[${index}]`)
        }
      }

      for (let index = 0; index < this.roots.value.length; index++) {
        visit(this.roots.value[index], `root[${index}]`)
      }

      this.reconcileRuntimeInstances(runtimeKeys)
      return { contributions, serviceContributions, slots }
    } finally {
      this.flattenDepth--
    }
  })

  /** Replace the entire active registry item tree. */
  configure(items: readonly RegistryItem[]): void {
    this.roots.value = items
  }

  /** Replace the active tree and await every runtime instance it unmounts. */
  configureAsync(items: readonly RegistryItem[]): Promise<void> {
    this.latestReconciliation = Promise.resolve()
    this.roots.value = items
    void this.flat.value
    return this.latestReconciliation
  }

  /** Replace the content of one slot while preserving unrelated runtime state. */
  reconfigure(slot: Slot, items: readonly RegistryItem[]): void {
    if (this.flattenDepth > 0) {
      throw new ReconfigurationError(
        'Cannot reconfigure a slot while building the registry graph.'
      )
    }

    if (this.combineDepth > 0) {
      throw new ReconfigurationError(
        'Cannot reconfigure a slot while combining a value spec.'
      )
    }

    let holder = this.slotContent.get(slot.id)
    if (!holder) {
      holder = signal(items)
      this.slotContent.set(slot.id, holder)
    }
    holder.value = items
  }

  /** Replace one slot and await every runtime instance it unmounts. */
  reconfigureAsync(slot: Slot, items: readonly RegistryItem[]): Promise<void> {
    this.latestReconciliation = Promise.resolve()
    this.reconfigure(slot, items)
    // Flattening is otherwise lazy. Force this transition so inactive runtime
    // instances begin disposal even when no value-spec or service is read next.
    void this.flat.value
    return this.latestReconciliation
  }

  /** Resolve a registry value spec or service as a live Preact signal. */
  signal<T>(service: Service<T>): ReadonlySignal<T | undefined>
  signal<I, O>(valueSpec: ValueSpec<I, O>): ReadonlySignal<O>
  signal(
    arg: Service<unknown> | ValueSpec<unknown, unknown>
  ): ReadonlySignal<unknown> {
    if (isServiceDefinition(arg)) {
      const existingServiceSignal = this.serviceSignals.get(arg.id)
      if (existingServiceSignal) return existingServiceSignal

      const created = computed(() => this.resolveService(arg))
      this.serviceSignals.set(arg.id, created)
      return created
    }

    const existingRegistryValueSpecSignal = this.registryValueSpecSignals.get(
      arg.id
    )
    if (existingRegistryValueSpecSignal) return existingRegistryValueSpecSignal

    const created = computed(() => {
      const matching = dedupeContributions(
        sortContributions(
          this.flat.value.contributions.filter(
            (item) => item.valueSpec.id === arg.id
          )
        )
      )

      if (matching.length === 0) return arg.defaultValue

      this.combineDepth++
      try {
        return arg.combine(
          matching.map((item) => unwrapMaybeSignal(item.value))
        )
      } finally {
        this.combineDepth--
      }
    })

    this.registryValueSpecSignals.set(arg.id, created)
    return created
  }

  /** Resolve a required registry value spec or service snapshot. */
  get<T>(service: Service<T>): T
  get<I, O>(valueSpec: ValueSpec<I, O>): O
  get(arg: Service<unknown> | ValueSpec<unknown, unknown>): unknown {
    if (isServiceDefinition(arg)) {
      const value = this.signal(arg).value
      if (value === undefined) {
        throw new MissingServiceError(`Missing required service: ${arg.name}`)
      }
      return value
    }

    return this.signal(arg).value
  }

  /** Resolve an optional service snapshot. */
  optional<T>(service: Service<T>): T | undefined {
    return this.signal(service).value
  }

  /** Inspect which active contributions currently feed a registry value spec. */
  debugValueSpec<I, O>(
    valueSpec: ValueSpec<I, O>
  ): ReadonlySignal<readonly DebugValueSpecItem[]> {
    const existing = this.debugValueSpecItems.get(valueSpec.id)
    if (existing) return existing

    const created = computed(() => {
      const matching = dedupeContributions(
        sortContributions(
          this.flat.value.contributions.filter(
            (item) => item.valueSpec.id === valueSpec.id
          )
        )
      )

      return matching.map((item) => ({
        valueSpecName: valueSpec.name,
        sourcePath: item.sourcePath,
        precedence: item.precedence,
        key: item.key,
        reactive: isReadonlySignal(item.value),
      }))
    })

    this.debugValueSpecItems.set(valueSpec.id, created)
    return created
  }

  /** Inspect which active registry items currently provide a service. */
  debugService<T>(
    service: Service<T>
  ): ReadonlySignal<readonly DebugServiceItem[]> {
    const existing = this.debugServiceItems.get(service.id)
    if (existing) return existing

    const created = computed(() => {
      const matching = this.flat.value.serviceContributions.filter(
        (item) => item.service.id === service.id
      )

      return matching.map((item) => ({
        serviceName: service.name,
        sourcePath: item.sourcePath,
        multiple: service.multiple,
      }))
    })

    this.debugServiceItems.set(service.id, created)
    return created
  }

  /** Lightweight container diagnostics useful in tests and devtools. */
  inspect() {
    const flat = this.flat.value

    return {
      runtimeInstanceCount: this.runtimeInstances.size,
      valueSpecCount: new Set(
        flat.contributions.map((item) => item.valueSpec.id)
      ).size,
      serviceCount: new Set(
        flat.serviceContributions.map((item) => item.service.id)
      ).size,
      slots: flat.slots.size,
    }
  }

  /** Internal guard used by service wrappers to preserve signal-combine purity. */
  isCombining(): boolean {
    return this.combineDepth > 0
  }

  /**
   * Resolve the current implementation of a service.
   *
   * Guards enforced here:
   * - no eager service reads while flattening the registry graph
   * - no recursive resolution cycles
   * - singleton services must have exactly one provider
   * - exposed services are sanitized before being returned
   */
  private resolveService<T>(service: Service<T>): T | undefined {
    if (this.flattenDepth > 0) {
      throw new ServiceResolutionError(
        `Service ${service.name} was requested while building the registry graph. ` +
          'Defer service reads to computed signal inputs, effects, or event handlers.'
      )
    }

    if (this.resolvingServices.has(service.id)) {
      throw new ServiceResolutionError(
        `Detected recursive service resolution for ${service.name}. ` +
          'Avoid cyclic service dependencies.'
      )
    }

    this.resolvingServices.add(service.id)
    try {
      const matches = this.flat.value.serviceContributions.filter(
        (item) => item.service.id === service.id
      )
      if (matches.length === 0) return undefined

      if (!service.multiple && matches.length > 1) {
        throw new ServiceConflictError(
          `Service ${service.name} has ${matches.length} providers (${matches
            .map((item) => item.sourcePath)
            .join(', ')}). ` +
            'Singleton services must have exactly one active provider.'
        )
      }

      if (service.multiple) {
        return Object.freeze(
          matches.map((item) => {
            if (
              !item.implementation ||
              typeof item.implementation !== 'object'
            ) {
              throw new ServiceResolutionError(
                `Service ${service.name} must be provided by an object so Preact signals and methods can be protected.`
              )
            }

            return sanitizeServiceImplementation(
              this,
              service,
              item.implementation
            )
          })
        ) as unknown as T
      }

      const provider = matches[0]?.implementation
      if (!provider || typeof provider !== 'object') {
        throw new ServiceResolutionError(
          `Service ${service.name} must be provided by an object so Preact signals and methods can be protected.`
        )
      }

      return sanitizeServiceImplementation(this, service, provider) as T
    } finally {
      this.resolvingServices.delete(service.id)
    }
  }

  /** Create or reuse a runtime instance for one registry item factory. */
  private ensureRuntimeInstance(
    key: RegistryItemKey,
    factory: RegistryItemFactory<unknown>,
    ctx: RegistryItemContext
  ): RuntimeInstance {
    const existing = this.runtimeInstances.get(key)
    if (existing) return existing

    const handle = factory(ctx)
    const instance: RuntimeInstance = {
      key,
      handle,
      dispose: normalizeDisposer(handle.item.dispose),
    }

    this.runtimeInstances.set(key, instance)
    return instance
  }

  /** Dispose runtime instances that are no longer reachable from the registry graph. */
  private reconcileRuntimeInstances(
    activeKeys: ReadonlySet<RegistryItemKey>
  ): void {
    const disposers: Array<() => unknown> = []
    for (const [key, instance] of this.runtimeInstances) {
      if (activeKeys.has(key)) continue

      this.runtimeInstances.delete(key)
      if (instance.dispose) disposers.push(instance.dispose)
    }

    this.latestReconciliation = this.enqueueDisposers(disposers.reverse())
  }

  /** Start cleanup immediately while retaining its awaitable completion. */
  private enqueueDisposers(
    disposers: readonly (() => unknown)[]
  ): Promise<void> {
    if (disposers.length === 0) return Promise.resolve()

    const completion = this.disposeBatch(disposers)
    this.pendingDisposals.add(completion)
    void completion.then(
      () => this.pendingDisposals.delete(completion),
      () => this.pendingDisposals.delete(completion)
    )
    // Attach recovery immediately so ignored synchronous APIs cannot produce
    // unhandled rejections; awaited APIs still receive `completion` itself.
    void completion.catch(() => undefined)
    return completion
  }

  private async disposeBatch(
    disposers: readonly (() => unknown)[]
  ): Promise<void> {
    const failures: Array<{ readonly index: number; readonly error: unknown }> =
      []
    const pending: Promise<void>[] = []

    for (let index = 0; index < disposers.length; index++) {
      const dispose = disposers[index]
      try {
        const result = dispose()
        if (isPromiseLike(result)) {
          pending.push(
            Promise.resolve(result).then(
              () => undefined,
              (error) => {
                failures.push({ index, error })
              }
            )
          )
        }
      } catch (error) {
        failures.push({ index, error })
      }
    }

    // Every runtime is deactivated in reverse construction order before an
    // asynchronous finalizer can yield. This prevents queued work from
    // observing half-mounted sibling runtimes during teardown.
    await Promise.all(pending)

    if (failures.length > 0) {
      failures.sort((left, right) => left.index - right.index)
      throw new AggregateError(
        failures.map((failure) => failure.error),
        'One or more registry runtime instances failed to dispose.'
      )
    }
  }

  private async awaitDisposalCompletions(
    completions: readonly Promise<void>[]
  ): Promise<void> {
    const results = await Promise.allSettled(completions)
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'One or more registry cleanup batches failed to complete.'
      )
    }
  }

  private beginShutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise

    const disposers = [...this.runtimeInstances.values()]
      .reverse()
      .flatMap((instance) => (instance.dispose ? [instance.dispose] : []))
    const pendingBeforeShutdown = [...this.pendingDisposals]
    // Finalizers may consult services owned by runtimes earlier in the graph.
    // Invoke their synchronous phase before clearing the registry, then await
    // any asynchronous continuation after the graph is deactivated.
    const shutdownDisposal = this.enqueueDisposers(disposers)
    this.runtimeInstances.clear()
    this.roots.value = []
    this.slotContent.clear()
    this.registryValueSpecSignals.clear()
    this.debugValueSpecItems.clear()
    this.serviceSignals.clear()
    this.debugServiceItems.clear()
    this.shutdownPromise = this.awaitDisposalCompletions([
      ...pendingBeforeShutdown,
      shutdownDisposal,
    ])
    return this.shutdownPromise
  }

  /** Dispose the container and all active runtime instances synchronously. */
  [Symbol.dispose](): void {
    for (const [, instance] of this.runtimeInstances) {
      try {
        instance.dispose?.()
      } catch {
        // ignore cleanup failures during shutdown
      }
    }

    this.runtimeInstances.clear()
    this.roots.value = []
    this.slotContent.clear()
    this.registryValueSpecSignals.clear()
    this.debugValueSpecItems.clear()
    this.serviceSignals.clear()
    this.debugServiceItems.clear()
  }

  /** Dispose the container and await all active runtime finalizers. */
  disposeAsync(): Promise<void> {
    return this.beginShutdown()
  }
}
