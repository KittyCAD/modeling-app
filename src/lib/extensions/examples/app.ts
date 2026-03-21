import { type ReadonlySignal, computed, signal } from '@preact/signals-core'
import { appendFacet, defineFacet, mergeObjectsFacet } from '../facet'
import {
  defineExtension,
  defineExtensionFactory,
  defineRuntimeExtension,
  provide,
  provideService,
} from '../helpers'
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
export const workspaceCompartment = new Compartment()

export const baseExtension = defineExtension({
  id: 'base-extension',
  provides: [provide(settingsFacet, { theme: 'dark' })],
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
