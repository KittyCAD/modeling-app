import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  type ProjectLibrarySetting,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import projectLibrariesExtension from '@src/lib/projectLibraries/registry'
import {
  projectLibraryRealizationsService,
  projectLibraryRealizationsValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

function createSettingsService(libraries: readonly ProjectLibrarySetting[]) {
  const current = signal({
    app: {
      libraries: {
        current: libraries,
      },
    },
  })

  return {
    actor: {
      getSnapshot: () => ({
        matches: (state: string) => state === 'idle',
      }),
    },
    current,
    get: () => current.value,
    send: vi.fn(),
    useSettings: () => current.value,
  } as unknown as SettingsRegistryService
}

describe('project library realizations registry service', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('refreshes watched libraries and invalidates only the library that changes', async () => {
    const librarySettings = [
      {
        title: 'Library A',
        path: '/projects-a',
        type: 'custom-directory',
      },
      {
        title: 'Library B',
        path: '/projects-b',
        type: 'custom-directory',
      },
    ] satisfies ProjectLibrarySetting[]
    const readRealizations = vi.fn(async () => [])
    const registrations: {
      path: string
      key: string
      callback: (eventType: string, path: string) => void
      options?: { depth?: number }
    }[] = []
    const originalElectron = window.electron
    const electronMock = {
      ...(originalElectron ?? {}),
      watchFileOn: vi.fn((path, key, callback, options) => {
        registrations.push({ path, key, callback, options })
      }),
      watchFileOff: vi.fn(),
    } as NonNullable<typeof window.electron>
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electronMock,
    })
    let dispose: (() => void) | undefined

    try {
      registry = new Registry()
      registry.configure([
        defineRegistryItem({
          id: 'test.settings',
          providesServices: [
            provideService(
              settingsService,
              createSettingsService(librarySettings)
            ),
          ],
        }),
        defineRegistryItem({
          id: 'test.custom-library-type',
          provides: [
            provide(projectLibraryTypesValueSpec, {
              type: 'custom-directory',
              title: 'Custom Directory',
              readRealizations,
            }),
          ],
        }),
        projectLibrariesExtension,
      ])
      expect(
        registry.signal(projectLibraryRealizationsValueSpec).value
      ).toEqual([])

      await waitFor(() => expect(readRealizations).toHaveBeenCalledTimes(2))
      readRealizations.mockClear()

      dispose = registry
        .get(projectLibraryRealizationsService)
        .watchConfiguredLibraries({
          libraries: projectLibrariesFromSettings(librarySettings),
        })
      expect(electronMock.watchFileOn).toHaveBeenCalledWith(
        '/projects-a',
        expect.any(String),
        expect.any(Function),
        { depth: 0 }
      )
      expect(electronMock.watchFileOn).toHaveBeenCalledWith(
        '/projects-b',
        expect.any(String),
        expect.any(Function),
        { depth: 0 }
      )
      await waitFor(() => expect(readRealizations).toHaveBeenCalledTimes(2))
      readRealizations.mockClear()

      vi.useFakeTimers()
      const libraryAWatcher = registrations.find(
        (registration) => registration.path === '/projects-a'
      )

      libraryAWatcher?.callback('unlinkDir', '/projects-a/old-project/main.kcl')
      libraryAWatcher?.callback('unlinkDir', '/projects-b/old-project')
      libraryAWatcher?.callback('ready', '/projects-a/old-project')
      await vi.advanceTimersByTimeAsync(750)
      expect(readRealizations).not.toHaveBeenCalled()

      libraryAWatcher?.callback('unlinkDir', '/projects-a/old-project')
      await vi.advanceTimersByTimeAsync(750)
      await Promise.resolve()
      await Promise.resolve()

      expect(readRealizations).toHaveBeenCalledTimes(1)
      expect(readRealizations).toHaveBeenCalledWith(
        expect.objectContaining({
          library: expect.objectContaining({ path: '/projects-a' }),
        })
      )
      expect(readRealizations).not.toHaveBeenCalledWith(
        expect.objectContaining({
          library: expect.objectContaining({ path: '/projects-b' }),
        })
      )

      dispose()
      dispose = undefined
      expect(electronMock.watchFileOff).toHaveBeenCalledTimes(2)
    } finally {
      dispose?.()
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: originalElectron,
      })
    }
  })
})
