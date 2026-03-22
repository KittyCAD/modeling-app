import { type ReadonlySignal, computed, signal } from '@preact/signals-core'
import { appendFacet, defineFacet, mergeObjectsFacet } from '../facet'
import {
  createCompartmentToggleController,
  createPlugin,
  defineExtension,
  defineExtensionFactory,
  defineRuntimeExtension,
  provide,
  provideService,
} from '../helpers'
import { ExtensionHost } from '../host'
import { defineService } from '../service'
import { Compartment, type ExtensionNode } from '../types'

/**
 * This file is intentionally more tutorial-like than the rest of the package.
 *
 * The example host demonstrates four layers of the system:
 * 1. facets model composable outputs like toolbars or panels
 * 2. services model imperative capabilities with signal-backed state
 * 3. runtime extensions own long-lived models and expose them through services
 * 4. plugins are the installable developer-facing unit built on top of all that
 *
 * Read this file top-to-bottom:
 * - start with the shapes that UI wants to render
 * - then the facet and service definitions
 * - then the static/runtime/plugin examples
 * - finally the `createExampleHost()` assembly at the bottom
 */

export interface Command {
  readonly id: string
  readonly label: string
  readonly run: () => void
}

export interface ToolbarItem {
  readonly id: string
  readonly label: string
  readonly run: () => void
  readonly visible?: boolean
}

export interface PanelItem {
  readonly id: string
  readonly label: string
  readonly visible?: boolean
}

export interface AppSettings {
  readonly theme: 'light' | 'dark'
  readonly showSidebar: boolean
}

/**
 * Services are stable capability objects.
 *
 * Signals expose live state.
 * Methods expose imperative behavior.
 */
export interface SearchService {
  readonly isOpen: ReadonlySignal<boolean>
  readonly query: ReadonlySignal<string>
  open(): void
  close(): void
  toggle(): void
  setQuery(value: string): void
}

export interface ToggleService {
  readonly active: ReadonlySignal<boolean>
  enable(): void
  disable(): void
  toggle(): void
}

export type WorkspaceToggleService = ToggleService
export type AnalyticsToggleService = ToggleService

export interface AnalyticsService {
  readonly eventCount: ReadonlySignal<number>
  track(eventName: string): void
}

/**
 * This service is the "plugin API" for the notes plugin.
 *
 * The downstream helper plugin still imports `notesPanelFacet` statically, but
 * it uses this service as:
 * - a presence marker so it can hide its contribution when the base plugin is
 *   not installed
 * - a place to expose plugin-owned API surface for cooperating plugins
 */
export interface NotesPluginApi {
  readonly panelFacet: typeof notesPanelFacet
  readonly pluginTitle: string
}

/**
 * Facets are typed extension points.
 *
 * Any number of extensions can contribute to a facet. The host gathers those
 * inputs and runs the facet's pure `combine()` function to produce one resolved
 * output.
 */
export const commandsFacet = appendFacet<Command>('commands')

export const toolbarFacet = defineFacet<ToolbarItem, readonly ToolbarItem[]>({
  name: 'toolbar',
  defaultValue: [],
  combine: (inputs) => inputs.filter((item) => item.visible !== false),
})

export const notesPanelFacet = defineFacet<PanelItem, readonly PanelItem[]>({
  name: 'notes-panel',
  defaultValue: [],
  combine: (inputs) => inputs.filter((item) => item.visible !== false),
})

export const settingsFacet = mergeObjectsFacet<AppSettings>('settings', {
  theme: 'light',
  showSidebar: true,
})

/**
 * Services are the dependency-injection layer.
 *
 * Unlike facets, services are usually singleton capabilities that other
 * extensions read lazily from the host.
 */
export const searchService = defineService<SearchService>('search')
export const workspaceToggleService =
  defineService<WorkspaceToggleService>('workspace-toggle')
export const analyticsService = defineService<AnalyticsService>('analytics')
export const analyticsToggleService =
  defineService<AnalyticsToggleService>('analytics-toggle')
export const notesPluginApiService =
  defineService<NotesPluginApi>('notes-plugin-api')

/**
 * Compartments are replaceable subtrees of the extension graph.
 *
 * Toggling one compartment should preserve unrelated runtime state owned by the
 * rest of the host.
 */
export const workspaceCompartment = new Compartment()
export const analyticsCompartment = new Compartment()

/**
 * Static extensions are plain declarative contributions. They are the easiest
 * thing to author and should be preferred when no local model or cleanup is
 * needed.
 */
export const baseExtension = defineExtension({
  id: 'base-extension',
  provides: [provide(settingsFacet, { theme: 'dark' })],
})

export const personalWorkspaceExtension = defineExtension({
  id: 'workspace.personal',
  provides: [
    provide(
      toolbarFacet,
      {
        id: 'workspace.current',
        label: 'Workspace: Personal',
        run: () => {},
      },
      { key: 'workspace.current', precedence: 'high' }
    ),
    provide(settingsFacet, { showSidebar: true }),
  ],
})

export const teamWorkspaceExtension = defineExtension({
  id: 'workspace.team',
  provides: [
    provide(
      toolbarFacet,
      {
        id: 'workspace.current',
        label: 'Workspace: Team',
        run: () => {},
      },
      { key: 'workspace.current', precedence: 'highest' }
    ),
    provide(settingsFacet, { showSidebar: false }),
  ],
})

/**
 * Runtime extensions are where long-lived models usually live.
 *
 * This one owns search state and exposes it through a service plus a reactive
 * toolbar contribution.
 */
export const searchExtension = defineExtensionFactory(() => {
  const isOpen = signal(false)
  const query = signal('')

  const serviceImpl: SearchService = {
    isOpen,
    query,
    open: () => {
      isOpen.value = true
    },
    close: () => {
      isOpen.value = false
    },
    toggle: () => {
      isOpen.value = !isOpen.value
    },
    setQuery: (value) => {
      query.value = value
    },
  }

  return {
    extension: defineRuntimeExtension({
      id: 'search-extension',
      providesServices: [provideService(searchService, serviceImpl)],
      provides: [
        provide(
          toolbarFacet,
          computed(() => ({
            id: 'search.toggle',
            label: isOpen.value ? 'Close Search' : 'Open Search',
            run: () => {
              isOpen.value = !isOpen.value
            },
          })),
          { key: 'search.toggle' }
        ),
      ],
    }),
  }
}, 'search-extension-factory')

/**
 * Runtime extensions can also depend on other runtime services.
 *
 * Notice the important pattern here:
 * - the extension factory itself does not eagerly read a service
 * - instead, the service read is deferred into `computed(...)`
 * - that keeps graph construction pure and lets the contribution react when the
 *   upstream service changes
 */
export const searchStatusExtension = defineExtensionFactory(({ services }) => {
  return {
    extension: defineExtension({
      id: 'search-status-extension',
      provides: [
        provide(
          toolbarFacet,
          computed(() => {
            const search = services.get(searchService)
            return {
              id: 'search.status',
              label: search.query.value
                ? `Searching: ${search.query.value}`
                : 'Search Idle',
              run: () => search.open(),
            }
          }),
          { key: 'search.status', precedence: 'low' }
        ),
      ],
    }),
  }
}, 'search-status-extension')

/**
 * This runtime extension is the canonical "feature toggle" pattern.
 *
 * The controller service lives outside `workspaceCompartment`, so the toggle
 * remains reachable even after the compartment content is turned off.
 */
export const workspaceToggleExtension = defineExtensionFactory(({ host }) => {
  const controller = createCompartmentToggleController({
    host,
    compartment: workspaceCompartment,
    activeExtensions: [teamWorkspaceExtension],
    initialActive: false,
  })

  return {
    extension: defineRuntimeExtension({
      id: 'workspace-toggle-extension',
      providesServices: [provideService(workspaceToggleService, controller)],
      provides: [
        provide(
          toolbarFacet,
          computed(() => ({
            id: 'workspace.toggle',
            label: controller.active.value
              ? 'Disable Team Workspace'
              : 'Enable Team Workspace',
            run: () => controller.toggle(),
          })),
          { key: 'workspace.toggle', precedence: 'high' }
        ),
      ],
    }),
  }
}, 'workspace-toggle-extension')

/**
 * Upstream runtime service example.
 *
 * This service provider is intentionally simple. The interesting part is the
 * downstream extension below that treats this service as optional.
 */
export const analyticsProviderExtension = defineExtensionFactory(() => {
  const eventCount = signal(0)

  const serviceImpl: AnalyticsService = {
    eventCount,
    track: () => {
      eventCount.value += 1
    },
  }

  return {
    extension: defineRuntimeExtension({
      id: 'analytics-provider-extension',
      providesServices: [provideService(analyticsService, serviceImpl)],
      provides: [
        provide(
          toolbarFacet,
          computed(() => ({
            id: 'analytics.track',
            label: `Track Analytics Event (${eventCount.value})`,
            run: () => serviceImpl.track('toolbar'),
          })),
          { key: 'analytics.track', precedence: 'low' }
        ),
      ],
    }),
  }
}, 'analytics-provider-extension')

/**
 * Optional dependency example.
 *
 * This runtime extension depends on `analyticsService`, but it does so through
 * `services.optional(...)` inside a computed contribution. That means it can
 * gracefully degrade when the upstream runtime provider is missing.
 */
export const analyticsStatusExtension = defineExtensionFactory(
  ({ services }) => {
    return {
      extension: defineExtension({
        id: 'analytics-status-extension',
        provides: [
          provide(
            toolbarFacet,
            computed(() => {
              const analytics = services.optional(analyticsService)

              if (!analytics) {
                return {
                  id: 'analytics.status',
                  label: 'Analytics Unavailable',
                  run: () => {},
                }
              }

              return {
                id: 'analytics.status',
                label: `Analytics Events: ${analytics.eventCount.value}`,
                run: () => analytics.track('status'),
              }
            }),
            { key: 'analytics.status', precedence: 'low' }
          ),
        ],
      }),
    }
  },
  'analytics-status-extension'
)

/**
 * The analytics provider itself is also compartment-backed so the example can
 * demonstrate `optional(service)` reacting when the upstream runtime disappears.
 */
function createAnalyticsToggleExtension(initialActive: boolean) {
  return defineExtensionFactory(
    ({ host }) => {
      const controller = createCompartmentToggleController({
        host,
        compartment: analyticsCompartment,
        activeExtensions: [analyticsProviderExtension],
        initialActive,
      })

      return {
        extension: defineRuntimeExtension({
          id: 'analytics-toggle-extension',
          providesServices: [
            provideService(analyticsToggleService, controller),
          ],
          provides: [
            provide(
              toolbarFacet,
              computed(() => ({
                id: 'analytics.toggle',
                label: controller.active.value
                  ? 'Disable Analytics Provider'
                  : 'Enable Analytics Provider',
                run: () => controller.toggle(),
              })),
              { key: 'analytics.toggle', precedence: 'high' }
            ),
          ],
        }),
      }
    },
    `analytics-toggle-extension:${initialActive ? 'active' : 'inactive'}`
  )
}

/**
 * Base plugin example.
 *
 * Plugins are the installable developer-facing unit. This one owns a new facet
 * (`notesPanelFacet`) and a small API service that downstream plugins can use
 * as a presence marker or compatibility surface.
 */
const notesPluginBaseExtension = defineExtension({
  id: 'notes-plugin.base',
  providesServices: [
    provideService(notesPluginApiService, {
      panelFacet: notesPanelFacet,
      pluginTitle: 'Notes',
    }),
  ],
  provides: [
    provide(notesPanelFacet, {
      id: 'notes.welcome',
      label: 'Welcome note from the Notes plugin',
    }),
  ],
})

export const notesPlugin = createPlugin({
  id: 'notes',
  title: 'Notes',
  description:
    'Provides a plugin-owned notes panel facet and a small API service for cooperating plugins.',
  extensions: [notesPluginBaseExtension],
})

/**
 * Downstream plugin example.
 *
 * This plugin extends a facet owned by another plugin. The facet target is
 * still imported statically, but the optional service is used to:
 * - detect whether the upstream plugin is installed
 * - consume plugin-owned metadata (`pluginTitle`)
 * - hide the contribution when the upstream plugin is absent
 */
const notesHelperPluginExtension = defineExtensionFactory(({ services }) => {
  return {
    extension: defineExtension({
      id: 'notes-helper-plugin.extension',
      provides: [
        provide(
          notesPanelFacet,
          computed(() => {
            const notesApi = services.optional(notesPluginApiService)
            return {
              id: 'notes.helper',
              label: notesApi
                ? `${notesApi.pluginTitle} Helper: Suggested summary`
                : 'Notes Helper unavailable',
              visible: notesApi !== undefined,
            }
          }),
          { key: 'notes.helper' }
        ),
      ],
    }),
  }
}, 'notes-helper-plugin.extension')

export const notesHelperPlugin = createPlugin({
  id: 'notes-helper',
  title: 'Notes Helper',
  description:
    'Extends the notes panel when the Notes plugin is installed, and hides itself otherwise.',
  extensions: [notesHelperPluginExtension],
})

export interface ExampleHostOptions {
  readonly includeAnalyticsProvider?: boolean
  readonly includeNotesPlugin?: boolean
  readonly includeNotesHelperPlugin?: boolean
}

/**
 * Build the example graph from a few switches so tests can demonstrate how the
 * same extension tree behaves as dependencies appear and disappear.
 */
export function createExampleExtensions(
  options: ExampleHostOptions = {}
): readonly ExtensionNode[] {
  const {
    includeAnalyticsProvider = true,
    includeNotesPlugin = true,
    includeNotesHelperPlugin = true,
  } = options

  return [
    baseExtension,
    personalWorkspaceExtension,
    searchExtension,
    searchStatusExtension,
    workspaceToggleExtension,
    workspaceCompartment.of(),
    createAnalyticsToggleExtension(includeAnalyticsProvider),
    analyticsStatusExtension,
    analyticsCompartment.of(
      ...(includeAnalyticsProvider ? [analyticsProviderExtension] : [])
    ),
    ...(includeNotesPlugin ? [notesPlugin] : []),
    ...(includeNotesHelperPlugin ? [notesHelperPlugin] : []),
  ]
}

/**
 * Default example graph used by tests and docs.
 *
 * It includes:
 * - static configuration
 * - runtime services and runtime-to-runtime dependencies
 * - compartment-backed feature toggles
 * - a pair of cooperating plugins
 */
export const defaultExampleExtensions = createExampleExtensions()

/**
 * Construct a host preloaded with the example graph.
 */
export function createExampleHost(options: ExampleHostOptions = {}) {
  const host = new ExtensionHost()
  host.configure(createExampleExtensions(options))
  return host
}
