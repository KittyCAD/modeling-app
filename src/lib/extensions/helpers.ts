import { type ReadonlySignal, computed, signal } from '@preact/signals-core'
import { CombineMutationError, ServiceResolutionError } from './errors'
import type { ExtensionHost } from './host'
import { Compartment } from './types'
import type {
  ExtensionDefinition,
  ExtensionFactory,
  ExtensionKey,
  ExtensionNode,
  Facet,
  FacetContribution,
  MaybeSignal,
  Precedence,
  RuntimeExtensionDefinition,
  Service,
  ServiceContribution,
} from './types'
import { defineService } from './service'
import { appendFacet } from './facet'

export const precedenceRank: Record<Precedence, number> = {
  highest: 0,
  high: 1,
  default: 2,
  low: 3,
  lowest: 4,
}

/** Narrow unknown values to signal-like objects. */
export function isReadonlySignal<T>(
  value: unknown
): value is ReadonlySignal<T> {
  return !!value && typeof value === 'object' && 'value' in value
}

/** Resolve either a static value or a signal-backed value to a snapshot. */
export function unwrapMaybeSignal<T>(value: MaybeSignal<T>): T {
  return isReadonlySignal<T>(value) ? value.value : value
}

/** Normalize function-based and Symbol.dispose-based cleanup into one shape. */
export function normalizeDisposer(
  dispose?: { [Symbol.dispose](): void } | (() => void)
): (() => void) | undefined {
  if (!dispose) return undefined
  if (typeof dispose === 'function') return dispose
  return () => dispose[Symbol.dispose]()
}

/** Sort contributions by precedence bucket and then declaration order. */
export function sortContributions<
  T extends { precedence: Precedence; order: number },
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const diff = precedenceRank[a.precedence] - precedenceRank[b.precedence]
    return diff !== 0 ? diff : a.order - b.order
  })
}

/**
 * Deduplicate contributions by explicit key.
 *
 * This is meant for stable identities like commands, toolbar items, or shared
 * infrastructure pieces. It intentionally does not attempt structural equality.
 */
export function dedupeContributions<T extends { key?: ExtensionKey }>(
  items: readonly T[]
): T[] {
  const out: T[] = []
  const seen = new Set<ExtensionKey>()

  for (const item of items) {
    if (item.key != null) {
      if (seen.has(item.key)) continue
      seen.add(item.key)
    }
    out.push(item)
  }

  return out
}

/**
 * Rewrap a signal through a computed so callers only receive a readonly view.
 */
export function readonlyFromSignal<T>(
  value: ReadonlySignal<T>
): ReadonlySignal<T> {
  return computed(() => value.value)
}

/**
 * Stable controller shape for toggling a compartment-backed feature subtree.
 *
 * If callers bypass this controller and reconfigure the compartment directly,
 * the `active` signal may no longer reflect the host's true state.
 */
export interface CompartmentToggleController {
  readonly active: ReadonlySignal<boolean>
  enable(): void
  disable(): void
  toggle(): void
}

/**
 * Protect service implementations before exposing them to consumers.
 *
 * Goals:
 * - methods become guarded wrappers so facet combine functions cannot call them
 * - signal-valued fields are re-exposed as readonly signals
 * - the final service object is frozen to discourage mutation of the surface
 *
 * This does not deeply freeze arbitrary nested data, but it protects the main
 * service contract and the common reactive entry points.
 */
export function sanitizeServiceImplementation<T extends object>(
  host: ExtensionHost,
  service: Service<T>,
  implementation: T
): T {
  const out: Record<PropertyKey, unknown> = {}

  for (const key of Reflect.ownKeys(implementation)) {
    const descriptor = Object.getOwnPropertyDescriptor(implementation, key)
    if (!descriptor) continue

    if ('value' in descriptor) {
      const value = descriptor.value

      if (typeof value === 'function') {
        out[key] = (...args: unknown[]) => {
          if (host.isCombining()) {
            throw new CombineMutationError(
              `Service method ${service.name}.${String(key)}() was called while combining a facet. ` +
                'Facet combine functions must be pure.'
            )
          }

          return value.apply(implementation, args)
        }
        continue
      }

      if (isReadonlySignal(value)) {
        out[key] = readonlyFromSignal(value)
        continue
      }

      out[key] = value
      continue
    }

    Object.defineProperty(out, key, {
      enumerable: descriptor.enumerable,
      configurable: false,
      get: descriptor.get
        ? () => {
            const value = descriptor.get?.call(implementation)
            return isReadonlySignal(value) ? readonlyFromSignal(value) : value
          }
        : undefined,
      set: descriptor.set
        ? () => {
            throw new ServiceResolutionError(
              `Service ${service.name} exposes writable accessor ${String(key)}. ` +
                'Service surfaces should be readonly.'
            )
          }
        : undefined,
    })
  }

  return Object.freeze(out) as T
}

/** Helpers for authoring extensions. */
export function defineExtensionFactory<TModel = unknown>(
  factory: ExtensionFactory<TModel>,
  extensionKey?: ExtensionKey
): ExtensionFactory<TModel> {
  Object.defineProperty(factory, 'extensionKey', {
    value: extensionKey ?? factory,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return factory
}

export function defineExtension<T extends ExtensionDefinition>(spec: T): T {
  return spec
}

export function defineRuntimeExtension<T extends RuntimeExtensionDefinition>(
  spec: T
): T {
  return spec
}

/** Human-facing metadata shown for a plugin in plugin-management UIs. */
interface PluginInfo {
  id: string
  title: string
  description: string
}

/** Input shape for constructing a plugin with a toggleable compartment. */
interface PluginSpec extends PluginInfo {
  extensions: readonly ExtensionNode[]
}

/**
 * Resolved plugin metadata exposed through `pluginsFacet`.
 *
 * The `service` is plugin-management metadata. It points at a stable
 * controller that lives outside the plugin's compartment and can toggle the
 * plugin subtree at runtime.
 */
export interface PluginRecord extends PluginInfo {
  service: Service<CompartmentToggleController>
}

/** Registry of installed plugins for settings screens and similar UIs. */
export const pluginsFacet = appendFacet<PluginRecord>('plugins')

/**
 * Build a plugin from declarative extension content.
 *
 * A plugin is modeled as one installable extension node with:
 * - one compartment that owns the plugin's runtime-toggled subtree
 * - one controller service that can reconfigure that compartment
 * - one metadata contribution for discovery and UI presentation
 *
 * UI contributed by a plugin should read app or router context from React
 * hooks at render time rather than from the runtime extension factory context.
 */
export function createPlugin({
  extensions,
  ...info
}: PluginSpec): ExtensionDefinition {
  const compartment = new Compartment()
  const toggle = createToggleableExtension({
    name: info.id,
    extensions,
    compartment,
  })
  return defineExtension({
    id: info.id,
    provides: [
      provide(pluginsFacet, {
        ...info,
        service: toggle.service,
      }),
    ],
    uses: [compartment.of(...extensions), toggle.extension],
  })
}

/**
 * Create a stable toggle-controller service for a compartment-backed feature.
 *
 * The controller extension must live outside the compartment it mutates so the
 * service remains available after the feature is turned off.
 */
function createToggleableExtension({
  name,
  extensions,
  compartment,
}: {
  name: string
  extensions: readonly ExtensionNode[]
  compartment: Compartment
}) {
  const service = defineService<CompartmentToggleController>(`${name}-toggle`)
  return {
    service,
    extension: defineExtensionFactory((ctx) => {
      const impl = createCompartmentToggleController({
        host: ctx.host,
        activeExtensions: extensions,
        initialActive: true,
        compartment,
      })
      return {
        extension: defineRuntimeExtension({
          providesServices: [provideService(service, impl)],
        }),
      }
    }, `${name}-toggle-ext`),
  }
}

type CompartmentToggleControllerProps = {
  host: Pick<ExtensionHost, 'reconfigure'>
  compartment: Compartment
  activeExtensions: readonly ExtensionNode[]
  inactiveExtensions?: readonly ExtensionNode[]
  initialActive?: boolean
}

/**
 * Build a controller service for a compartment-backed feature toggle.
 *
 * The controller should live outside the compartment it mutates.
 * `initialActive` should match the host's initial compartment contents.
 */
export function createCompartmentToggleController({
  host,
  compartment,
  activeExtensions,
  inactiveExtensions = [],
  initialActive = false,
}: CompartmentToggleControllerProps): CompartmentToggleController {
  const active = signal(initialActive)

  return {
    active,
    enable() {
      active.value = true
      host.reconfigure(compartment, activeExtensions)
    },
    disable() {
      active.value = false
      host.reconfigure(compartment, inactiveExtensions)
    },
    toggle() {
      if (active.value) {
        this.disable()
        return
      }

      this.enable()
    },
  }
}

export function provide<I>(
  facet: Facet<I, any>,
  value: MaybeSignal<I>,
  options?: Pick<FacetContribution<I>, 'precedence' | 'key'>
): FacetContribution<I> {
  return {
    facet,
    value,
    precedence: options?.precedence,
    key: options?.key,
  }
}

export function provideService<T>(
  service: Service<T>,
  implementation: T
): ServiceContribution<T> {
  return { service, implementation }
}
