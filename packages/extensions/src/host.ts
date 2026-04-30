import {
  type ReadonlySignal,
  type Signal as PreactSignal,
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
  Compartment,
  DebugSignalItem,
  DebugServiceItem,
  ExtensionContext,
  ExtensionFactory,
  ExtensionKey,
  ExtensionNode,
  Precedence,
  RuntimeExtensionHandle,
  Service,
  ServiceReader,
  Signal,
  SignalReader,
} from './types'
import { CompartmentInstance } from './types'

interface FlattenedContribution {
  readonly signal: Signal<any, any>
  readonly value: any
  readonly precedence: Precedence
  readonly key?: ExtensionKey
  readonly order: number
  readonly sourcePath: string
}

interface FlattenedServiceContribution {
  readonly service: Service<any>
  readonly implementation: unknown
  readonly sourcePath: string
}

interface RuntimeInstance {
  readonly key: ExtensionKey
  readonly handle: RuntimeExtensionHandle<any>
  readonly dispose?: () => void
}

interface FlattenResult {
  readonly contributions: readonly FlattenedContribution[]
  readonly serviceContributions: readonly FlattenedServiceContribution[]
  readonly compartments: ReadonlyMap<symbol, readonly ExtensionNode[]>
}

function isServiceDefinition(
  arg: Service<any> | Signal<any, any>
): arg is Service<any> {
  return 'multiple' in arg
}

/**
 * ExtensionHost resolves extension graphs into live signals and services.
 *
 * Conceptually:
 * - signals are the composition layer
 * - services are the capability layer
 * - Preact signals are the reactivity layer
 * - runtime factories / models are the lifecycle layer
 */
export class ExtensionHost implements SignalReader, ServiceReader {
  private readonly roots = signal<readonly ExtensionNode[]>([])
  private readonly compartmentContent = new Map<
    symbol,
    PreactSignal<readonly ExtensionNode[]>
  >()
  private readonly extensionSignals = new Map<symbol, ReadonlySignal<any>>()
  private readonly debugSignalItems = new Map<
    symbol,
    ReadonlySignal<readonly DebugSignalItem[]>
  >()
  private readonly serviceSignals = new Map<symbol, ReadonlySignal<any>>()
  private readonly debugServiceItems = new Map<
    symbol,
    ReadonlySignal<readonly DebugServiceItem[]>
  >()
  private readonly runtimeInstances = new Map<ExtensionKey, RuntimeInstance>()
  private readonly resolvingServices = new Set<symbol>()

  private combineDepth = 0
  private flattenDepth = 0

  private readonly flat = computed<FlattenResult>(() => {
    this.flattenDepth++

    try {
      const contributions: FlattenedContribution[] = []
      const serviceContributions: FlattenedServiceContribution[] = []
      const compartments = new Map<symbol, readonly ExtensionNode[]>()
      const runtimeKeys = new Set<ExtensionKey>()
      const seenExtensions = new Set<ExtensionKey>()
      let order = 0

      const ctx: ExtensionContext = {
        host: this,
        signals: this,
        services: this,
      }

      const visit = (node: ExtensionNode, path: string): void => {
        if (node instanceof CompartmentInstance) {
          compartments.set(node.compartment.id, node.content)

          let holder = this.compartmentContent.get(node.compartment.id)
          if (!holder) {
            holder = signal(node.content)
            this.compartmentContent.set(node.compartment.id, holder)
          }

          for (const child of holder.value) {
            visit(child, `${path}/compartment`)
          }
          return
        }

        if (typeof node === 'function') {
          const key = node.extensionKey ?? node
          const runtime = this.ensureRuntimeInstance(key, node, ctx)
          runtimeKeys.add(key)
          visit(runtime.handle.extension, `${path}/factory`)
          return
        }

        if (node.id != null) {
          if (seenExtensions.has(node.id)) return
          seenExtensions.add(node.id)
        }

        for (const contribution of node.provides ?? []) {
          contributions.push({
            signal: contribution.signal,
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
      return { contributions, serviceContributions, compartments }
    } finally {
      this.flattenDepth--
    }
  })

  /** Replace the entire active extension tree. */
  configure(extensions: readonly ExtensionNode[]): void {
    this.roots.value = extensions
  }

  /** Replace the content of one compartment while preserving unrelated runtime state. */
  reconfigure(
    compartment: Compartment,
    extensions: readonly ExtensionNode[]
  ): void {
    if (this.flattenDepth > 0) {
      throw new ReconfigurationError(
        'Cannot reconfigure a compartment while building the extension graph.'
      )
    }

    if (this.combineDepth > 0) {
      throw new ReconfigurationError(
        'Cannot reconfigure a compartment while combining a signal.'
      )
    }

    let holder = this.compartmentContent.get(compartment.id)
    if (!holder) {
      holder = signal(extensions)
      this.compartmentContent.set(compartment.id, holder)
    }
    holder.value = extensions
  }

  /** Resolve an extension signal or service as a live Preact signal. */
  signal<T>(service: Service<T>): ReadonlySignal<T | undefined>
  signal<I, O>(signalDef: Signal<I, O>): ReadonlySignal<O>
  signal(arg: Service<any> | Signal<any, any>): ReadonlySignal<any> {
    if (isServiceDefinition(arg)) {
      const existing = this.serviceSignals.get(arg.id)
      if (existing) return existing

      const created = computed(() => this.resolveService(arg))
      this.serviceSignals.set(arg.id, created)
      return created
    }

    const existing = this.extensionSignals.get(arg.id)
    if (existing) return existing

    const created = computed(() => {
      const matching = dedupeContributions(
        sortContributions(
          this.flat.value.contributions.filter(
            (item) => item.signal.id === arg.id
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

    this.extensionSignals.set(arg.id, created)
    return created
  }

  /** Resolve a required extension signal or service snapshot. */
  get<T>(service: Service<T>): T
  get<I, O>(signalDef: Signal<I, O>): O
  get(arg: Service<any> | Signal<any, any>): any {
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

  /** Inspect which active contributions currently feed an extension signal. */
  debugSignal<I, O>(
    signalDef: Signal<I, O>
  ): ReadonlySignal<readonly DebugSignalItem[]> {
    const existing = this.debugSignalItems.get(signalDef.id)
    if (existing) return existing

    const created = computed(() => {
      const matching = dedupeContributions(
        sortContributions(
          this.flat.value.contributions.filter(
            (item) => item.signal.id === signalDef.id
          )
        )
      )

      return matching.map((item) => ({
        signalName: signalDef.name,
        sourcePath: item.sourcePath,
        precedence: item.precedence,
        key: item.key,
        reactive: isReadonlySignal(item.value),
      }))
    })

    this.debugSignalItems.set(signalDef.id, created)
    return created
  }

  /** Inspect which active extensions currently provide a service. */
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

  /** Lightweight host diagnostics useful in tests and devtools. */
  inspect() {
    const flat = this.flat.value

    return {
      runtimeInstanceCount: this.runtimeInstances.size,
      signalCount: new Set(flat.contributions.map((item) => item.signal.id))
        .size,
      serviceCount: new Set(
        flat.serviceContributions.map((item) => item.service.id)
      ).size,
      compartments: flat.compartments.size,
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
   * - no eager service reads while flattening the extension graph
   * - no recursive resolution cycles
   * - singleton services must have exactly one provider
   * - exposed services are sanitized before being returned
   */
  private resolveService<T>(service: Service<T>): T | undefined {
    if (this.flattenDepth > 0) {
      throw new ServiceResolutionError(
        `Service ${service.name} was requested while building the extension graph. ` +
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
                `Service ${service.name} must be provided by an object so signals and methods can be protected.`
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
          `Service ${service.name} must be provided by an object so signals and methods can be protected.`
        )
      }

      return sanitizeServiceImplementation(this, service, provider) as T
    } finally {
      this.resolvingServices.delete(service.id)
    }
  }

  /** Create or reuse a runtime instance for one extension factory. */
  private ensureRuntimeInstance(
    key: ExtensionKey,
    factory: ExtensionFactory<any>,
    ctx: ExtensionContext
  ): RuntimeInstance {
    const existing = this.runtimeInstances.get(key)
    if (existing) return existing

    const handle = factory(ctx)
    const instance: RuntimeInstance = {
      key,
      handle,
      dispose: normalizeDisposer(handle.extension.dispose),
    }

    this.runtimeInstances.set(key, instance)
    return instance
  }

  /** Dispose runtime instances that are no longer reachable from the extension graph. */
  private reconcileRuntimeInstances(
    activeKeys: ReadonlySet<ExtensionKey>
  ): void {
    for (const [key, instance] of this.runtimeInstances) {
      if (activeKeys.has(key)) continue

      try {
        instance.dispose?.()
      } catch {
        // cleanup failures are intentionally swallowed during reconciliation
      }

      this.runtimeInstances.delete(key)
    }
  }

  /** Dispose the host and all active runtime instances. */
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
    this.compartmentContent.clear()
    this.extensionSignals.clear()
    this.debugSignalItems.clear()
    this.serviceSignals.clear()
    this.debugServiceItems.clear()
  }
}
