import { type ReadonlySignal, computed, signal } from '@preact/signals-core'
import {
  createPlugin,
  createSlotToggleController,
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '../helpers'
import { Registry } from '../registry'
import { defineService } from '../service'
import { type RegistryItem, Slot } from '../types'
import {
  appendValueSpec,
  defineValueSpec,
  mergeObjectsValueSpec,
} from '../valueSpec'

/**
 * This file is intentionally more tutorial-like than the rest of the package.
 *
 * The example registry demonstrates four layers of the system:
 * 1. value specs model composable outputs like toolbars or panels
 * 2. services model imperative capabilities with Preact-signal-backed state
 * 3. runtime registry items own long-lived models and expose them through services
 * 4. plugins are the installable developer-facing unit built on top of all that
 *
 * Read this file top-to-bottom:
 * - start with the shapes that UI wants to render
 * - then the signal and service definitions
 * - then the static/runtime/plugin examples
 * - finally the `createExampleRegistry()` assembly at the bottom
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
 * The downstream helper plugin still imports `notesPanelValueSpec` statically, but
 * it uses this service as:
 * - a presence marker so it can hide its contribution when the base plugin is
 *   not installed
 * - a place to expose plugin-owned API surface for cooperating plugins
 */
export interface NotesPluginApi {
  readonly panelSignal: typeof notesPanelValueSpec
  readonly pluginTitle: string
}

/**
 * Value specs are typed registry points.
 *
 * Any number of registry items can contribute to a signal. The registry gathers those
 * inputs and runs the signal's pure `combine()` function to produce one resolved
 * output.
 */
export const commandsValueSpec = appendValueSpec<Command>('commands')

export const toolbarValueSpec = defineValueSpec<
  ToolbarItem,
  readonly ToolbarItem[]
>({
  name: 'toolbar',
  defaultValue: [],
  combine: (inputs) => inputs.filter((item) => item.visible !== false),
})

export const notesPanelValueSpec = defineValueSpec<
  PanelItem,
  readonly PanelItem[]
>({
  name: 'notes-panel',
  defaultValue: [],
  combine: (inputs) => inputs.filter((item) => item.visible !== false),
})

export const settingsValueSpec = mergeObjectsValueSpec<AppSettings>(
  'settings',
  {
    theme: 'light',
    showSidebar: true,
  }
)

/**
 * Services are the dependency-injection layer.
 *
 * Unlike value specs, services are usually singleton capabilities that other
 * registry items read lazily from the registry.
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
 * Slots are replaceable subtrees of the registry graph.
 *
 * Toggling one slot should preserve unrelated runtime state owned by the
 * rest of the registry.
 */
export const workspaceSlot = new Slot()
export const analyticsSlot = new Slot()

/**
 * Static registry items are plain declarative contributions. They are the easiest
 * thing to author and should be preferred when no local model or cleanup is
 * needed.
 */
export const baseRegistryItem = defineRegistryItem({
  id: 'base-registry-item',
  provides: [provide(settingsValueSpec, { theme: 'dark' })],
})

export const personalWorkspaceRegistryItem = defineRegistryItem({
  id: 'workspace.personal',
  provides: [
    provide(
      toolbarValueSpec,
      {
        id: 'workspace.current',
        label: 'Workspace: Personal',
        run: () => {},
      },
      { key: 'workspace.current', precedence: 'high' }
    ),
    provide(settingsValueSpec, { showSidebar: true }),
  ],
})

export const teamWorkspaceRegistryItem = defineRegistryItem({
  id: 'workspace.team',
  provides: [
    provide(
      toolbarValueSpec,
      {
        id: 'workspace.current',
        label: 'Workspace: Team',
        run: () => {},
      },
      { key: 'workspace.current', precedence: 'highest' }
    ),
    provide(settingsValueSpec, { showSidebar: false }),
  ],
})

/**
 * Runtime registry items are where long-lived models usually live.
 *
 * This one owns search state and exposes it through a service plus a reactive
 * toolbar contribution.
 */
export const searchRegistryItem = defineRegistryItemFactory(() => {
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
    item: defineRuntimeRegistryItem({
      id: 'search-registry-item',
      providesServices: [provideService(searchService, serviceImpl)],
      provides: [
        provide(
          toolbarValueSpec,
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
}, 'search-registry-item-factory')

/**
 * Runtime registry items can also depend on other runtime services.
 *
 * Notice the important pattern here:
 * - the registry item factory itself does not eagerly read a service
 * - instead, the service read is deferred into `computed(...)`
 * - that keeps graph construction pure and lets the contribution react when the
 *   upstream service changes
 */
export const searchStatusRegistryItem = defineRegistryItemFactory(
  ({ services }) => {
    return {
      item: defineRegistryItem({
        id: 'search-status-registry-item',
        provides: [
          provide(
            toolbarValueSpec,
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
  },
  'search-status-registry-item'
)

/**
 * `uses` is the structural composition primitive for declarative registry items.
 *
 * This bundle does not contribute value specs or services directly. Instead, it says
 * "when you install `searchFeatureRegistryItem`, also install these child
 * registry items." Reach for `uses` when a few registry items always ship together and
 * you want one higher-level unit without introducing plugin metadata or toggle
 * behavior.
 */
export const searchFeatureRegistryItem = defineRegistryItem({
  id: 'search-feature-registry-item',
  uses: [searchRegistryItem, searchStatusRegistryItem],
})

/**
 * This runtime registry item is the canonical "feature toggle" pattern.
 *
 * The controller service lives outside `workspaceSlot`, so the toggle
 * remains reachable even after the slot content is turned off.
 */
export const workspaceToggleRegistryItem = defineRegistryItemFactory(
  ({ container }) => {
    const controller = createSlotToggleController({
      container,
      slot: workspaceSlot,
      activeItems: [teamWorkspaceRegistryItem],
      initialActive: false,
    })

    return {
      item: defineRuntimeRegistryItem({
        id: 'workspace-toggle-registry-item',
        providesServices: [provideService(workspaceToggleService, controller)],
        provides: [
          provide(
            toolbarValueSpec,
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
  },
  'workspace-toggle-registry-item'
)

/**
 * Upstream runtime service example.
 *
 * This service provider is intentionally simple. The interesting part is the
 * downstream registry item below that treats this service as optional.
 */
export const analyticsProviderRegistryItem = defineRegistryItemFactory(() => {
  const eventCount = signal(0)

  const serviceImpl: AnalyticsService = {
    eventCount,
    track: () => {
      eventCount.value += 1
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'analytics-provider-registry-item',
      providesServices: [provideService(analyticsService, serviceImpl)],
      provides: [
        provide(
          toolbarValueSpec,
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
}, 'analytics-provider-registry-item')

/**
 * Optional dependency example.
 *
 * This runtime registry item depends on `analyticsService`, but it does so through
 * `services.optional(...)` inside a computed contribution. That means it can
 * gracefully degrade when the upstream runtime provider is missing.
 */
export const analyticsStatusRegistryItem = defineRegistryItemFactory(
  ({ services }) => {
    return {
      item: defineRegistryItem({
        id: 'analytics-status-registry-item',
        provides: [
          provide(
            toolbarValueSpec,
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
  'analytics-status-registry-item'
)

/**
 * The analytics provider itself is also slot-backed so the example can
 * demonstrate `optional(service)` reacting when the upstream runtime disappears.
 */
function createAnalyticsToggleRegistryItem(initialActive: boolean) {
  return defineRegistryItemFactory(
    ({ container }) => {
      const controller = createSlotToggleController({
        container,
        slot: analyticsSlot,
        activeItems: [analyticsProviderRegistryItem],
        initialActive,
      })

      return {
        item: defineRuntimeRegistryItem({
          id: 'analytics-toggle-registry-item',
          providesServices: [
            provideService(analyticsToggleService, controller),
          ],
          provides: [
            provide(
              toolbarValueSpec,
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
    `analytics-toggle-registry-item:${initialActive ? 'active' : 'inactive'}`
  )
}

/**
 * Base plugin example.
 *
 * Plugins are the installable developer-facing unit. This one owns a new signal
 * (`notesPanelValueSpec`) and a small API service that downstream plugins can use
 * as a presence marker or compatibility surface.
 */
const notesPluginBaseRegistryItem = defineRegistryItem({
  id: 'notes-plugin.base',
  providesServices: [
    provideService(notesPluginApiService, {
      panelSignal: notesPanelValueSpec,
      pluginTitle: 'Notes',
    }),
  ],
  provides: [
    provide(notesPanelValueSpec, {
      id: 'notes.welcome',
      label: 'Welcome note from the Notes plugin',
    }),
  ],
})

export const notesPlugin = createPlugin({
  id: 'notes',
  title: 'Notes',
  description:
    'Provides a plugin-owned notes panel signal and a small API service for cooperating plugins.',
  items: [notesPluginBaseRegistryItem],
})

/**
 * Downstream plugin example.
 *
 * This plugin extends a signal owned by another plugin. The signal target is
 * still imported statically, but the optional service is used to:
 * - detect whether the upstream plugin is installed
 * - consume plugin-owned metadata (`pluginTitle`)
 * - hide the contribution when the upstream plugin is absent
 */
const notesHelperPluginRegistryItem = defineRegistryItemFactory(
  ({ services }) => {
    return {
      item: defineRegistryItem({
        id: 'notes-helper-plugin.registry-item',
        provides: [
          provide(
            notesPanelValueSpec,
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
  },
  'notes-helper-plugin.registry-item'
)

export const notesHelperPlugin = createPlugin({
  id: 'notes-helper',
  title: 'Notes Helper',
  description:
    'Extends the notes panel when the Notes plugin is installed, and hides itself otherwise.',
  items: [notesHelperPluginRegistryItem],
})

export interface ExampleRegistryOptions {
  readonly includeAnalyticsProvider?: boolean
  readonly includeNotesPlugin?: boolean
  readonly includeNotesHelperPlugin?: boolean
}

/**
 * Build the example graph from a few switches so tests can demonstrate how the
 * same registry tree behaves as dependencies appear and disappear.
 */
export function createExampleExtensions(
  options: ExampleRegistryOptions = {}
): readonly RegistryItem[] {
  const {
    includeAnalyticsProvider = true,
    includeNotesPlugin = true,
    includeNotesHelperPlugin = true,
  } = options

  return [
    baseRegistryItem,
    personalWorkspaceRegistryItem,
    searchFeatureRegistryItem,
    workspaceToggleRegistryItem,
    workspaceSlot.of(),
    createAnalyticsToggleRegistryItem(includeAnalyticsProvider),
    analyticsStatusRegistryItem,
    analyticsSlot.of(
      ...(includeAnalyticsProvider ? [analyticsProviderRegistryItem] : [])
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
 * - slot-backed feature toggles
 * - a pair of cooperating plugins
 */
export const defaultExampleRegistryItems = createExampleExtensions()

/**
 * Construct a registry preloaded with the example graph.
 */
export function createExampleRegistry(options: ExampleRegistryOptions = {}) {
  const registry = new Registry()
  registry.configure(createExampleExtensions(options))
  return registry
}
