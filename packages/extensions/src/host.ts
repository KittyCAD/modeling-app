import {
  type ReadonlySignal,
  type Signal,
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
  DebugFacetItem,
  DebugServiceItem,
  ExtensionContext,
  ExtensionFactory,
  ExtensionKey,
  ExtensionNode,
  Facet,
  FacetReader,
  Precedence,
  RuntimeExtensionHandle,
  Service,
  ServiceReader,
} from './types'
import { CompartmentInstance } from './types'

interface FlattenedContribution {
  readonly facet: Facet<any, any>
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
  arg: Service<any> | Facet<any, any>
): arg is Service<any> {
  return 'multiple' in arg
}

/**
 * ExtensionHost resolves extension graphs into live facets and services.
 *
 * Conceptually:
 * - facets are the composition layer
 * - services are the capability layer
 * - signals are the reactivity layer
 * - runtime factories / models are the lifecycle layer
 */
export class ExtensionHost implements FacetReader, ServiceReader {
  private readonly roots = signal<readonly ExtensionNode[]>([])
  private readonly compartmentContent = new Map<
    symbol,
    Signal<readonly ExtensionNode[]>
  >()
  private readonly facetSignals = new Map<symbol, ReadonlySignal<any>>()
  private readonly debugFacetItems = new Map<
    symbol,
    ReadonlySignal<readonly DebugFacetItem[]>
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
        facets: this,
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
            facet: contribution.facet,
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
        'Cannot reconfigure a compartment while combining a facet.'
      )
    }

    let holder = this.compartmentContent.get(compartment.id)
    if (!holder) {
      holder = signal(extensions)
      this.compartmentContent.set(compartment.id, holder)
    }
    holder.value = extensions
  }

  /** Resolve a facet or service as a live signal. */
  signal<T>(service: Service<T>): ReadonlySignal<T | undefined>
  signal<I, O>(facet: Facet<I, O>): ReadonlySignal<O>
  signal(arg: Service<any> | Facet<any, any>): ReadonlySignal<any> {
    if (isServiceDefinition(arg)) {
      const existing = this.serviceSignals.get(arg.id)
      if (existing) return existing

      const created = computed(() => this.resolveService(arg))
      this.serviceSignals.set(arg.id, created)
      return created
    }

    const existing = this.facetSignals.get(arg.id)
    if (existing) return existing

    const created = computed(() => {
      const matching = dedupeContributions(
        sortContributions(
          this.flat.value.contributions.filter(
            (item) => item.facet.id === arg.id
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

    this.facetSignals.set(arg.id, created)
    return created
  }

  /** Resolve a required facet or service snapshot. */
  get<T>(service: Service<T>): T
  get<I, O>(facet: Facet<I, O>): O
  get(arg: Service<any> | Facet<any, any>): any {
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

  /** Inspect which active contributions currently feed a facet. */
  debugFacet<I, O>(
    facet: Facet<I, O>
  ): ReadonlySignal<readonly DebugFacetItem[]> {
    const existing = this.debugFacetItems.get(facet.id)
    if (existing) return existing

    const created = computed(() => {
      const matching = dedupeContributions(
        sortContributions(
          this.flat.value.contributions.filter(
            (item) => item.facet.id === facet.id
          )
        )
      )

      return matching.map((item) => ({
        facetName: facet.name,
        sourcePath: item.sourcePath,
        precedence: item.precedence,
        key: item.key,
        reactive: isReadonlySignal(item.value),
      }))
    })

    this.debugFacetItems.set(facet.id, created)
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
      facetCount: new Set(flat.contributions.map((item) => item.facet.id)).size,
      serviceCount: new Set(
        flat.serviceContributions.map((item) => item.service.id)
      ).size,
      compartments: flat.compartments.size,
    }
  }

  /** Internal guard used by service wrappers to preserve combine purity. */
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
          'Defer service reads to computed facet inputs, effects, or event handlers.'
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
    this.facetSignals.clear()
    this.debugFacetItems.clear()
    this.serviceSignals.clear()
    this.debugServiceItems.clear()
  }
}
