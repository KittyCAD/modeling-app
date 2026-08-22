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

  it('lets a project library open and materialize a remote-only project', async () => {
    const registry = new Registry()
    const settings = signal({
      app: {
        libraries: {
          current: [library],
        },
      },
    })
    const openProject = vi.fn(async () => ({
      defaultFile: '/materialized/main.kcl',
    }))
    registry.configure([
      homeProjectsExtension,
      defineRegistryItem({
        id: 'remote-open-test-library',
        provides: [
          provide(projectLibraryTypesValueSpec, {
            type: library.type,
            title: library.title,
            operations: {
              openProject: {
                run: openProject,
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
      await expect(
        registry.get(homeProjectActionsService).open(project)
      ).resolves.toEqual({
        defaultFile: '/materialized/main.kcl',
      })
      expect(openProject).toHaveBeenCalledWith({
        library,
        project,
      })
    } finally {
      registry[Symbol.dispose]()
    }
  })
})
