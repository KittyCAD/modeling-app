import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DEFAULT_PROJECT_LIBRARY_ID,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultCloudProjectLibrarySetting,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import type { CloudSyncRegistryService } from '@src/registry/contracts/cloudSync'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectEntry,
  type HomeProjectEntryContribution,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import {
  type SystemIORegistryService,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import homeProjectsExtension from '@src/registry/extensions/homeProjects'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const desktopMocks = vi.hoisted(() => ({
  getProjectInfo: vi.fn(),
}))

const cloudSyncPathMocks = vi.hoisted(() => ({
  getCloudProjectLibraryMaterializationDirectoryPath: vi.fn(
    async (library: { path: string }) => library.path
  ),
}))

vi.mock('@src/lib/wasm_lib_wrapper', () => ({
  getModule: vi.fn(),
  init: vi.fn(),
  reloadModule: vi.fn(),
}))

vi.mock('@src/lib/desktop', () => {
  return {
    canReadWriteDirectory: vi.fn().mockResolvedValue({
      value: true,
      error: undefined,
    }),
    createNewProjectDirectory: vi.fn(),
    getProjectInfo: desktopMocks.getProjectInfo,
    isPathNotFoundError: vi.fn(() => false),
    mkdirOrNOOP: vi.fn().mockResolvedValue(undefined),
    writeProjectTitleToProjectToml: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@src/lib/cloudSync/paths', () => ({
  getCloudProjectLibraryMaterializationDirectoryPath:
    cloudSyncPathMocks.getCloudProjectLibraryMaterializationDirectoryPath,
}))

function createSettingsService(): SettingsRegistryService {
  const current = signal({
    app: {
      libraries: {
        current: [],
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

function createMutableSettingsService({
  libraries,
}: {
  libraries: { title: string; path: string; type: string }[]
}) {
  const current = signal({
    app: {
      libraries: {
        current: libraries,
      },
    },
    unrelated: {
      value: 0,
    },
  })

  return {
    current,
    service: {
      actor: {
        getSnapshot: () => ({
          matches: (state: string) => state === 'idle',
        }),
      },
      current,
      get: () => current.value,
      send: vi.fn(),
      useSettings: () => current.value,
    } as unknown as SettingsRegistryService,
  }
}

function createSystemIOService() {
  const send = vi.fn()

  return {
    service: {
      actor: {
        send,
        getSnapshot: () => ({
          context: {
            folders: undefined,
          },
          matches: (state: string) => state === 'idle',
        }),
        subscribe: vi.fn(() => ({
          unsubscribe: vi.fn(),
        })),
      },
    } as unknown as SystemIORegistryService,
    send,
  }
}

function createMutableSystemIOService({
  folders,
}: {
  folders: Project[] | undefined
}) {
  const send = vi.fn()
  const subscribers = new Set<() => void>()
  let snapshot = {
    context: {
      folders,
      requestedProjectName: {
        name: 'active-project',
      },
    },
    matches: (state: string) => state === 'idle',
  }

  return {
    service: {
      actor: {
        send,
        getSnapshot: () => snapshot,
        subscribe: vi.fn((callback: () => void) => {
          subscribers.add(callback)
          return {
            unsubscribe: () => {
              subscribers.delete(callback)
            },
          }
        }),
      },
    } as unknown as SystemIORegistryService,
    send,
    setFolders: (foldersNext: Project[] | undefined) => {
      snapshot = {
        ...snapshot,
        context: {
          ...snapshot.context,
          folders: foldersNext,
        },
      }
      for (const subscriber of subscribers) {
        subscriber()
      }
    },
  }
}

function createCloudSyncService(
  overrides: Partial<CloudSyncRegistryService> = {}
): CloudSyncRegistryService {
  return {
    status: signal({
      enabled: true,
      state: 'idle',
      pendingCount: 0,
    }),
    configure: vi.fn(),
    installFileSystemObserver: vi.fn(),
    retry: vi.fn(),
    setOpenedProject: vi.fn(),
    startProjectSync: vi.fn().mockResolvedValue(undefined),
    disconnectProjectSync: vi.fn().mockResolvedValue(undefined),
    deleteRemoteProject: vi.fn().mockResolvedValue(undefined),
    deleteLocalProjectRealizations: vi.fn().mockResolvedValue(undefined),
    ensureProjectLocallySynced: vi.fn().mockResolvedValue(undefined),
    getRemoteProjectThumbnailUrl: vi.fn().mockResolvedValue(undefined),
    getProjectMetadata: vi.fn().mockResolvedValue(undefined),
    getProjectMetadataIndex: vi.fn().mockResolvedValue(new Map()),
    getProjectModifiedTime: vi.fn((_metadata, localModified) => localModified),
    resolveProjectConflict: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('home project actions', () => {
  let registry: Registry | undefined

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    vi.restoreAllMocks()
  })

  it('keeps default directory entries while System IO folders are temporarily unset', async () => {
    const project = {
      name: 'local-project',
      title: 'Local Project',
      path: '/projects/local-project',
      default_file: '/projects/local-project/main.kcl',
      children: [],
      metadata: {
        accessed: null,
        created: null,
        modified: 100,
        permission: null,
        size: 1,
        type: 'directory',
      },
      kcl_file_count: 1,
      directory_count: 0,
      readWriteAccess: true,
    } satisfies Project
    const systemIO = createMutableSystemIOService({
      folders: [project],
    })
    const cloudSync = createCloudSyncService()

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test.settings',
        providesServices: [
          provideService(settingsService, createSettingsService()),
        ],
      }),
      defineRegistryItem({
        id: 'test.system-io',
        providesServices: [provideService(systemIOService, systemIO.service)],
      }),
      defineRegistryItem({
        id: 'test.cloud-sync',
        providesServices: [provideService(cloudSyncService, cloudSync)],
      }),
      homeProjectsExtension,
    ])

    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesValueSpec)).toEqual([
        expect.objectContaining({
          name: 'local-project',
          libraryIds: [DEFAULT_PROJECT_LIBRARY_ID],
        }),
      ])
    )

    systemIO.setFolders(undefined)
    await Promise.resolve()
    await Promise.resolve()

    expect(registry.get(homeProjectEntriesValueSpec)).toEqual([
      expect.objectContaining({
        name: 'local-project',
        libraryIds: [DEFAULT_PROJECT_LIBRARY_ID],
      }),
    ])

    systemIO.setFolders([])
    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesValueSpec)).toEqual([])
    )
  })

  it('does not clear configured library entries for unrelated settings updates', async () => {
    const settings = createMutableSettingsService({
      libraries: [
        {
          title: 'Custom Cloud',
          path: '/custom-cloud',
          type: 'custom-cloud',
        },
      ],
    })
    const systemIO = createSystemIOService()
    const cloudSync = createCloudSyncService()
    const readEntries = vi.fn(({ library }: { library: ProjectLibrary }) =>
      Promise.resolve([
        {
          source: 'local',
          status: 'synced',
          libraryId: library.id,
          name: 'untitled-43',
          title: 'untitled-43',
          localProjectPath: '/custom-cloud/untitled-43',
          localProjectName: 'untitled-43',
          remoteProjectId: 'remote-123',
          defaultFile: '/custom-cloud/untitled-43/main.kcl',
          readWriteAccess: true,
          thumbnail: {
            type: 'local',
            path: '/custom-cloud/untitled-43/thumbnail.png',
          },
        },
      ] satisfies HomeProjectEntryContribution[])
    )

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test.settings',
        providesServices: [provideService(settingsService, settings.service)],
      }),
      defineRegistryItem({
        id: 'test.system-io',
        providesServices: [provideService(systemIOService, systemIO.service)],
      }),
      defineRegistryItem({
        id: 'test.cloud-sync',
        providesServices: [provideService(cloudSyncService, cloudSync)],
      }),
      defineRegistryItem({
        id: 'test.custom-library-type',
        provides: [
          provide(projectLibraryTypesValueSpec, {
            type: 'custom-cloud',
            title: 'Custom Cloud',
            readEntries,
          }),
        ],
      }),
      homeProjectsExtension,
    ])

    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesValueSpec)).toEqual([
        expect.objectContaining({
          name: 'untitled-43',
          thumbnail: {
            type: 'local',
            path: '/custom-cloud/untitled-43/thumbnail.png',
          },
        }),
      ])
    )

    readEntries.mockClear()
    settings.current.value = {
      ...settings.current.value,
      unrelated: {
        value: 1,
      },
    }
    await Promise.resolve()
    await Promise.resolve()

    expect(readEntries).not.toHaveBeenCalled()
    expect(registry.get(homeProjectEntriesValueSpec)).toEqual([
      expect.objectContaining({
        name: 'untitled-43',
        thumbnail: {
          type: 'local',
          path: '/custom-cloud/untitled-43/thumbnail.png',
        },
      }),
    ])
  })

  it('opens remote-only cloud projects without forcing a full folder rescan', async () => {
    const wasmInstance = {} as never
    const wasmPromise = Promise.resolve(wasmInstance)
    const systemIO = createSystemIOService()
    const cloudSync = createCloudSyncService({
      ensureProjectLocallySynced: vi.fn().mockResolvedValue({
        projectPath: '/cloud-projects/remote-title',
        projectName: 'remote-title',
        remoteProjectId: 'remote-123',
      }),
    })
    desktopMocks.getProjectInfo.mockResolvedValue({
      default_file: '/cloud-projects/remote-title/main.kcl',
    })
    const remoteOnlyProject = {
      id: 'remote:remote-123',
      source: 'remote',
      status: 'cloud-only',
      libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
      name: 'remote-title',
      title: 'Remote title',
      remoteProjectId: 'remote-123',
      readWriteAccess: true,
    } satisfies HomeProjectEntry

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test.settings',
        providesServices: [
          provideService(
            settingsService,
            createMutableSettingsService({
              libraries: [
                getDefaultCloudProjectLibrarySetting('/cloud-projects'),
              ],
            }).service
          ),
        ],
      }),
      defineRegistryItem({
        id: 'test.system-io',
        providesServices: [provideService(systemIOService, systemIO.service)],
      }),
      defineRegistryItem({
        id: 'test.cloud-sync',
        providesServices: [provideService(cloudSyncService, cloudSync)],
      }),
      defineRegistryItem({
        id: 'test.wasm',
        provides: [provideWasmPromise(wasmPromise)],
      }),
      defineRegistryItem({
        id: 'test.cloud-library-type',
        provides: [
          provide(projectLibraryTypesValueSpec, {
            type: CLOUD_PROJECT_LIBRARY_TYPE,
            title: 'Cloud',
            readEntries: async () => [],
            operations: {
              openProject: {
                run: ({ project }) => {
                  if (!project.defaultFile) {
                    return undefined
                  }

                  return { defaultFile: project.defaultFile }
                },
              },
            },
          }),
        ],
      }),
      homeProjectsExtension,
    ])

    await expect(
      registry.get(homeProjectActionsService).open(remoteOnlyProject)
    ).resolves.toEqual({
      defaultFile: '/cloud-projects/remote-title/main.kcl',
    })
    expect(cloudSync.ensureProjectLocallySynced).toHaveBeenCalledWith(
      'remote-123',
      '/cloud-projects'
    )
    expect(desktopMocks.getProjectInfo).toHaveBeenCalledWith(
      '/cloud-projects/remote-title',
      wasmInstance
    )
    expect(systemIO.send).not.toHaveBeenCalled()
  })

  it('opens locally materialized cloud library projects without re-syncing them first', async () => {
    const wasmInstance = {} as never
    const wasmPromise = Promise.resolve(wasmInstance)
    const systemIO = createSystemIOService()
    const cloudSync = createCloudSyncService()
    const localCloudProject = {
      id: 'remote:remote-123',
      source: 'both',
      status: 'synced',
      libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
      name: 'remote-title',
      title: 'Remote title',
      localProjectPath: '/cloud-projects/remote-title',
      localProjectName: 'remote-title',
      remoteProjectId: 'remote-123',
      defaultFile: '/cloud-projects/remote-title/main.kcl',
      readWriteAccess: true,
    } satisfies HomeProjectEntry

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test.settings',
        providesServices: [
          provideService(
            settingsService,
            createMutableSettingsService({
              libraries: [getDefaultCloudProjectLibrarySetting()],
            }).service
          ),
        ],
      }),
      defineRegistryItem({
        id: 'test.system-io',
        providesServices: [provideService(systemIOService, systemIO.service)],
      }),
      defineRegistryItem({
        id: 'test.cloud-sync',
        providesServices: [provideService(cloudSyncService, cloudSync)],
      }),
      defineRegistryItem({
        id: 'test.wasm',
        provides: [provideWasmPromise(wasmPromise)],
      }),
      defineRegistryItem({
        id: 'test.cloud-library-type',
        provides: [
          provide(projectLibraryTypesValueSpec, {
            type: CLOUD_PROJECT_LIBRARY_TYPE,
            title: 'Cloud',
            readEntries: async () => [],
            operations: {
              openProject: {
                run: ({ project }) => {
                  if (!project.defaultFile) {
                    return undefined
                  }

                  return { defaultFile: project.defaultFile }
                },
              },
            },
          }),
        ],
      }),
      homeProjectsExtension,
    ])

    await expect(
      registry.get(homeProjectActionsService).open(localCloudProject)
    ).resolves.toEqual({
      defaultFile: '/cloud-projects/remote-title/main.kcl',
    })
    expect(cloudSync.ensureProjectLocallySynced).not.toHaveBeenCalled()
    expect(desktopMocks.getProjectInfo).not.toHaveBeenCalled()
    expect(systemIO.send).not.toHaveBeenCalled()
  })

  it('deletes only local state for a cloud-backed directory project', async () => {
    const systemIO = createSystemIOService()
    const cloudSync = createCloudSyncService()
    const removeProjectDirectory = vi
      .spyOn(fsZds, 'rm')
      .mockResolvedValue(undefined)

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test.settings',
        providesServices: [
          provideService(
            settingsService,
            createMutableSettingsService({
              libraries: [
                {
                  title: 'Projects',
                  path: '/projects',
                  type: DIRECTORY_PROJECT_LIBRARY_TYPE,
                },
              ],
            }).service
          ),
        ],
      }),
      defineRegistryItem({
        id: 'test.system-io',
        providesServices: [provideService(systemIOService, systemIO.service)],
      }),
      defineRegistryItem({
        id: 'test.cloud-sync',
        providesServices: [provideService(cloudSyncService, cloudSync)],
      }),
      homeProjectsExtension,
    ])

    const directoryLibraryType = registry
      .get(projectLibraryTypesValueSpec)
      .get(DIRECTORY_PROJECT_LIBRARY_TYPE)
    const deleteProject = directoryLibraryType?.operations?.deleteProject
    expect(deleteProject).toBeDefined()
    if (!deleteProject) {
      return
    }

    await deleteProject.run({
      library: {
        id: DEFAULT_PROJECT_LIBRARY_ID,
        title: 'Projects',
        path: '/projects',
        type: DIRECTORY_PROJECT_LIBRARY_TYPE,
      },
      project: {
        id: 'local:/projects/bracket',
        source: 'both',
        status: 'synced',
        libraryIds: [DEFAULT_PROJECT_LIBRARY_ID],
        name: 'bracket',
        localProjectPath: '/projects/bracket',
        localProjectName: 'bracket',
        remoteProjectId: 'remote-123',
        defaultFile: '/projects/bracket/main.kcl',
        readWriteAccess: true,
      },
    })

    expect(cloudSync.deleteLocalProjectRealizations).toHaveBeenCalledWith(
      'remote-123',
      '/projects/bracket'
    )
    expect(cloudSync.deleteRemoteProject).not.toHaveBeenCalled()
    expect(removeProjectDirectory).not.toHaveBeenCalled()
  })

  it('uses the owning directory library when a local project is merged with its cloud entry', async () => {
    const systemIO = createSystemIOService()
    const cloudSync = createCloudSyncService()
    const deleteCloudProject = vi.fn().mockResolvedValue(undefined)

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test.settings',
        providesServices: [
          provideService(
            settingsService,
            createMutableSettingsService({
              libraries: [
                getDefaultCloudProjectLibrarySetting('/cloud-projects'),
                {
                  title: 'Projects',
                  path: '/projects',
                  type: DIRECTORY_PROJECT_LIBRARY_TYPE,
                },
              ],
            }).service
          ),
        ],
      }),
      defineRegistryItem({
        id: 'test.system-io',
        providesServices: [provideService(systemIOService, systemIO.service)],
      }),
      defineRegistryItem({
        id: 'test.cloud-sync',
        providesServices: [provideService(cloudSyncService, cloudSync)],
      }),
      defineRegistryItem({
        id: 'test.cloud-library-type',
        provides: [
          provide(projectLibraryTypesValueSpec, {
            type: CLOUD_PROJECT_LIBRARY_TYPE,
            title: 'Cloud',
            readEntries: async () => [],
            operations: {
              deleteProject: {
                run: deleteCloudProject,
              },
            },
          }),
        ],
      }),
      homeProjectsExtension,
    ])

    await registry.get(homeProjectActionsService).delete({
      id: 'remote:remote-123',
      source: 'both',
      status: 'synced',
      libraryIds: [
        PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        DEFAULT_PROJECT_LIBRARY_ID,
      ],
      name: 'bracket',
      title: 'Bracket',
      localProjectPath: '/projects/bracket',
      localProjectName: 'bracket',
      libraryPath: '/projects',
      libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
      remoteProjectId: 'remote-123',
      defaultFile: '/projects/bracket/main.kcl',
      readWriteAccess: true,
    })

    expect(deleteCloudProject).not.toHaveBeenCalled()
    expect(cloudSync.deleteLocalProjectRealizations).toHaveBeenCalledWith(
      'remote-123',
      '/projects/bracket'
    )
    expect(cloudSync.deleteRemoteProject).not.toHaveBeenCalled()
  })
})
