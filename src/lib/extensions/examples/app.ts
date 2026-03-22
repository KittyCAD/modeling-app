import { type ReadonlySignal, computed, signal } from '@preact/signals-core'
import { appendFacet, defineFacet, mergeObjectsFacet } from '../facet'
import {
  createCompartmentToggleController,
  defineExtension,
  defineExtensionFactory,
  defineRuntimeExtension,
  provide,
  provideService,
} from '../helpers'
import { ExtensionHost } from '../host'
import { defineService } from '../service'
import { Compartment } from '../types'

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

export interface AppSettings {
  readonly theme: 'light' | 'dark'
  readonly showSidebar: boolean
}

export interface SearchService {
  readonly isOpen: ReadonlySignal<boolean>
  readonly query: ReadonlySignal<string>
  open(): void
  close(): void
  toggle(): void
  setQuery(value: string): void
}

export interface WorkspaceToggleService {
  readonly active: ReadonlySignal<boolean>
  enable(): void
  disable(): void
  toggle(): void
}

export const commandsFacet = appendFacet<Command>('commands')
export const toolbarFacet = defineFacet<ToolbarItem, readonly ToolbarItem[]>({
  name: 'toolbar',
  defaultValue: [],
  combine: (inputs) => inputs.filter((item) => item.visible !== false),
})
export const settingsFacet = mergeObjectsFacet<AppSettings>('settings', {
  theme: 'light',
  showSidebar: true,
})
export const searchService = defineService<SearchService>('search')
export const workspaceToggleService =
  defineService<WorkspaceToggleService>('workspace-toggle')
export const workspaceCompartment = new Compartment()

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

export const defaultExampleExtensions = [
  baseExtension,
  personalWorkspaceExtension,
  searchExtension,
  searchStatusExtension,
  workspaceToggleExtension,
  workspaceCompartment.of(),
] as const

export function createExampleHost() {
  const host = new ExtensionHost()
  host.configure(defaultExampleExtensions)
  return host
}
