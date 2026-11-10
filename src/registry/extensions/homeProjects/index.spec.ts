import {
  authService,
  type AuthRegistryService,
} from '@src/registry/contracts/auth'
import { projectLibrariesFromSettings } from '@src/lib/projectLibraries'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  PERSONAL_CLOUD_PROJECT_LIBRARY_TITLE,
} from '@src/lib/projectLibraries'
import {
  type HomeProjectEntry,
  homeProjectActionsService,
} from '@src/registry/contracts/homeProjects'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { cloudStorageService } from '@src/registry/contracts/fileOperations'
import type { CloudStorageService } from '@src/registry/contracts/fileOperations'
import homeProjectsExtension from '@src/registry/extensions/homeProjects'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

const library = {
  id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  title: PERSONAL_CLOUD_PROJECT_LIBRARY_TITLE,
  path: DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
  type: CLOUD_PROJECT_LIBRARY_TYPE,
} satisfies ProjectLibrary

const project = {
  id: 'remote:remote-project-123',
  source: 'remote',
  status: 'cloud-only',
  libraryIds: [library.id],
  name: 'Bracket',
  title: 'Bracket',
  remoteProjectId: 'remote-project-123',
  readWriteAccess: true,
} satisfies HomeProjectEntry

describe('home project actions', () => {
  it('connects visible Home cards to the fileOperations thumbnail watcher', () => {
    const stop = vi.fn()
    const watchThumbnail = vi.fn(() => stop)
    const registry = new Registry()
    registry.configure([
      homeProjectsExtension,
      defineRegistryItem({
        id: 'thumbnail-storage',
        providesServices: [
          provideService(cloudStorageService, {
            watchThumbnail,
          } as unknown as CloudStorageService),
        ],
      }),
    ])
    try {
      const stopWatching = registry
        .get(homeProjectActionsService)
        .watchRemoteThumbnail('remote-one')
      expect(watchThumbnail).toHaveBeenCalledWith('remote-one')
      expect(stop).not.toHaveBeenCalled()
      if (!stopWatching) throw new Error('Missing thumbnail watcher cleanup')
      stopWatching()
      expect(stop).toHaveBeenCalledOnce()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  it('allows a project library to duplicate a remote-only project', () => {
    const registry = new Registry()
    const settings = signal({
      app: {
        libraries: {
          current: [library],
        },
      },
    })
    registry.configure([
      homeProjectsExtension,
      defineRegistryItem({
        id: 'remote-duplicate-test-library',
        provides: [
          provide(projectLibraryTypesValueSpec, {
            type: library.type,
            title: library.title,
            operations: {
              duplicateProject: {
                run: async () => undefined,
              },
            },
          }),
        ],
        providesServices: [
          provideService(settingsService, {
            current: settings,
            get: () => settings.value,
          } as unknown as SettingsRegistryService),
        ],
      }),
    ])

    try {
      expect(
        registry.get(homeProjectActionsService).canDuplicate(project)
      ).toBe(true)
    } finally {
      registry[Symbol.dispose]()
    }
  })
  it('cancels a clone before the destination receives files when the account changes', async () => {
    const sourceSetting = { title: 'Dataset', path: '/source', type: 'dataset' }
    const targetSetting = {
      title: 'Destination',
      path: '/destination',
      type: 'target',
    }
    const configured = [sourceSetting, targetSetting]
    const [source, target] = projectLibrariesFromSettings(configured)
    const user = signal({ id: 'first-account' })
    const gate = Promise.withResolvers<{
      localProjectPath: string
      localProjectName: string
    }>()
    const cloneFrom = vi.fn(() => gate.promise)
    const cloneTo = vi.fn()
    const registry = new Registry()
    registry.configure([
      homeProjectsExtension,
      defineRegistryItem({
        id: 'account-clone-test',
        provides: [
          provide(projectLibraryTypesValueSpec, {
            type: 'dataset',
            title: 'Dataset',
            operations: { cloneProjectFrom: { run: cloneFrom } },
          }),
          provide(projectLibraryTypesValueSpec, {
            type: 'target',
            title: 'Target',
            operations: { cloneProjectTo: { run: cloneTo } },
          }),
        ],
        providesServices: [
          provideService(authService, {
            user,
            token: signal('token'),
          } as unknown as AuthRegistryService),
          provideService(settingsService, {
            current: signal({ app: { libraries: { current: configured } } }),
          } as unknown as SettingsRegistryService),
        ],
      }),
    ])
    try {
      const cloning = registry
        .get(homeProjectActionsService)
        .cloneToLibrary(
          { ...project, libraryIds: [source.id], readWriteAccess: false },
          target.id
        )
      expect(cloneFrom).toHaveBeenCalledOnce()
      user.value = { id: 'second-account' }
      gate.resolve({
        localProjectPath: '/source/model',
        localProjectName: 'Model',
      })
      await expect(cloning).rejects.toThrow('Your account changed')
      expect(cloneTo).not.toHaveBeenCalled()
    } finally {
      registry[Symbol.dispose]()
    }
  })
})
