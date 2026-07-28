import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DEFAULT_PROJECT_LIBRARY_ID,
  DEFAULT_PROJECT_LIBRARY_TITLE,
  getDefaultCloudProjectLibrarySetting,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  type ProjectLibrary,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import type { CloudSyncRegistryService } from '@src/registry/contracts/cloudSync'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectEntry,
  type HomeProjectEntryContribution,
  homeProjectActionsService,
  homeProjectEntriesLoadingValueSpec,
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
import homeProjectsExtension, {
  invalidateConfiguredProjectLibraryEntries,
} from '@src/registry/extensions/homeProjects'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const desktopMocks = vi.hoisted(() => ({
  getProjectInfo: vi.fn(),
}))

const cloudSyncPathMocks = vi.hoisted(() => ({
  getCloudProjectLibraryMaterializationDirectoryPath: vi.fn(),
  getDefaultCloudProjectDirectoryPath: vi.fn(),
}))

const directoryScannerMocks = vi.hoisted(() => ({
  readProjectsFromProjectDirectory: vi.fn(),
  scheduleProjectDirectoryNameSyncFromTitles: vi.fn(),
}))

vi.mock('@src/lib/wasm_lib_wrapper', () => ({
  getModule: vi.fn(),
  init: vi.fn(),
  reloadModule: vi.fn(),
}))

vi.mock('@src/lib/desktop', () => ({
  canReadWriteDirectory: vi.fn().mockResolvedValue({
    value: true,
    error: undefined,
  }),
  createNewProjectDirectory: vi.fn(),
  getProjectInfo: desktopMocks.getProjectInfo,
  isPathNotFoundError: vi.fn(() => false),
  mkdirOrNOOP: vi.fn().mockResolvedValue(undefined),
  writeProjectTitleToProjectToml: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@src/lib/cloudSync/paths', () => ({
  getCloudProjectLibraryMaterializationDirectoryPath:
    cloudSyncPathMocks.getCloudProjectLibraryMaterializationDirectoryPath,
  getDefaultCloudProjectDirectoryPath:
    cloudSyncPathMocks.getDefaultCloudProjectDirectoryPath,
}))

vi.mock(
  '@src/lib/projectLibraries/directoryScanner',
  () => directoryScannerMocks
)

function createProject({
  name,
  path,
}: {
  name: string
  path: string
}): Project {
  return {
    name,
    title: name,
    path,
    default_file: `${path}/main.kcl`,
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
  }
}

function createSettingsService({
  libraries = [],
}: {
  libraries?: ProjectLibrarySetting[]
} = {}): SettingsRegistryService {
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
  libraries: ProjectLibrarySetting[]
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
            folders: [
              createProject({
                name: 'system-io-only-project',
                path: '/system-io/system-io-only-project',
              }),
            ],
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
    setProjectScope: vi.fn(),
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

function configureHomeProjectsRegistry({
  cloudSync = createCloudSyncService(),
  extraItems = [],
  settings = createSettingsService(),
  systemIO = createSystemIOService(),
  wasmPromise = Promise.resolve({} as never),
}: {
  cloudSync?: CloudSyncRegistryService
  extraItems?: Parameters<Registry['configure']>[0]
  settings?: SettingsRegistryService
  systemIO?: ReturnType<typeof createSystemIOService>
  wasmPromise?: Promise<never>
} = {}) {
  const registry = new Registry()

  registry.configure([
    defineRegistryItem({
      id: 'test.settings',
      providesServices: [provideService(settingsService, settings)],
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
    ...extraItems,
    homeProjectsExtension,
  ])

  return {
    registry,
    systemIO,
  }
}

describe('home project library entries', () => {
  let registry: Registry | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    directoryScannerMocks.readProjectsFromProjectDirectory.mockResolvedValue([])
  })

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    vi.restoreAllMocks()
  })

  it('lists the default directory through the project library reader', async () => {
    const project = createProject({
      name: 'library-project',
      path: '/projects/library-project',
    })
    directoryScannerMocks.readProjectsFromProjectDirectory.mockResolvedValue([
      project,
    ])

    ;({ registry } = configureHomeProjectsRegistry({
      settings: createSettingsService({
        libraries: [
          {
            title: DEFAULT_PROJECT_LIBRARY_TITLE,
            path: '/projects',
            type: 'directory',
          },
        ],
      }),
    }))

    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesValueSpec)).toEqual([
        expect.objectContaining({
          name: 'library-project',
          libraryIds: [DEFAULT_PROJECT_LIBRARY_ID],
        }),
      ])
    )

    expect(
      directoryScannerMocks.readProjectsFromProjectDirectory
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDirectoryPath: '/projects',
      })
    )
    expect(
      registry.get(homeProjectEntriesValueSpec).map((entry) => entry.name)
    ).not.toContain('system-io-only-project')
  })

  it('does not clear or rescan library entries for unrelated settings updates', async () => {
    const settings = createMutableSettingsService({
      libraries: [
        {
          title: 'Custom Cloud',
          path: '/custom-cloud',
          type: 'custom-cloud',
        },
      ],
    })
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

    ;({ registry } = configureHomeProjectsRegistry({
      settings: settings.service,
      extraItems: [
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
      ],
    }))

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

  it('keeps previous entries visible while a library refresh is loading', async () => {
    let resolveFirstRead:
      | ((entries: HomeProjectEntryContribution[]) => void)
      | undefined
    let resolveSecondRead:
      | ((entries: HomeProjectEntryContribution[]) => void)
      | undefined
    const libraryEntry = {
      source: 'local',
      status: 'local',
      libraryId: 'custom-projects',
      name: 'stable-project',
      localProjectPath: '/custom/stable-project',
      localProjectName: 'stable-project',
      defaultFile: '/custom/stable-project/main.kcl',
      readWriteAccess: true,
    } satisfies HomeProjectEntryContribution
    const readEntries = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<HomeProjectEntryContribution[]>((resolve) => {
            resolveFirstRead = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<HomeProjectEntryContribution[]>((resolve) => {
            resolveSecondRead = resolve
          })
      )

    ;({ registry } = configureHomeProjectsRegistry({
      settings: createSettingsService({
        libraries: [
          {
            title: 'Custom Projects',
            path: '/custom',
            type: 'custom',
          },
        ],
      }),
      extraItems: [
        defineRegistryItem({
          id: 'test.custom-library-type',
          provides: [
            provide(projectLibraryTypesValueSpec, {
              type: 'custom',
              title: 'Custom',
              readEntries,
            }),
          ],
        }),
      ],
    }))

    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesLoadingValueSpec)).toBe(true)
    )
    resolveFirstRead?.([libraryEntry])
    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesValueSpec)).toEqual([
        expect.objectContaining({
          name: 'stable-project',
        }),
      ])
    )
    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesLoadingValueSpec)).toBe(false)
    )

    invalidateConfiguredProjectLibraryEntries()
    await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesLoadingValueSpec)).toBe(true)
    )
    expect(registry.get(homeProjectEntriesValueSpec)).toEqual([
      expect.objectContaining({
        name: 'stable-project',
      }),
    ])
    expect(readEntries.mock.calls[1][0].previousEntries).toEqual([
      expect.objectContaining({
        name: 'stable-project',
      }),
    ])

    resolveSecondRead?.([])
    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesValueSpec)).toEqual([])
    )
    await waitFor(() =>
      expect(registry?.get(homeProjectEntriesLoadingValueSpec)).toBe(false)
    )
  })
})

describe('home project actions', () => {
  let registry: Registry | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    directoryScannerMocks.readProjectsFromProjectDirectory.mockResolvedValue([])
    cloudSyncPathMocks.getCloudProjectLibraryMaterializationDirectoryPath.mockImplementation(
      async (library: ProjectLibrary) => library.path
    )
    cloudSyncPathMocks.getDefaultCloudProjectDirectoryPath.mockResolvedValue(
      '/cloud-projects'
    )
  })

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    vi.restoreAllMocks()
  })

  it('opens remote-only cloud projects without forcing a full folder rescan', async () => {
    const wasmInstance = {} as never
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
      name: 'remote-title',
      title: 'Remote title',
      remoteProjectId: 'remote-123',
      readWriteAccess: true,
    } satisfies HomeProjectEntry

    ;({ registry } = configureHomeProjectsRegistry({
      cloudSync,
      systemIO,
      wasmPromise: Promise.resolve(wasmInstance),
    }))

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

    ;({ registry } = configureHomeProjectsRegistry({
      cloudSync,
      settings: createSettingsService({
        libraries: [getDefaultCloudProjectLibrarySetting('/cloud-projects')],
      }),
      extraItems: [
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
      ],
      systemIO,
    }))

    await expect(
      registry.get(homeProjectActionsService).open(localCloudProject)
    ).resolves.toEqual({
      defaultFile: '/cloud-projects/remote-title/main.kcl',
    })
    expect(cloudSync.ensureProjectLocallySynced).not.toHaveBeenCalled()
    expect(desktopMocks.getProjectInfo).not.toHaveBeenCalled()
    expect(systemIO.send).not.toHaveBeenCalled()
  })

  it('materializes remote cloud library projects into their library directory', async () => {
    const wasmInstance = {} as never
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
    const remoteCloudProject = {
      id: 'remote:remote-123',
      source: 'remote',
      status: 'cloud-only',
      libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
      name: 'remote-title',
      title: 'Remote title',
      remoteProjectId: 'remote-123',
      readWriteAccess: true,
    } satisfies HomeProjectEntry

    ;({ registry } = configureHomeProjectsRegistry({
      cloudSync,
      settings: createSettingsService({
        libraries: [getDefaultCloudProjectLibrarySetting('/cloud-projects')],
      }),
      extraItems: [
        defineRegistryItem({
          id: 'test.cloud-library-type',
          provides: [
            provide(projectLibraryTypesValueSpec, {
              type: CLOUD_PROJECT_LIBRARY_TYPE,
              title: 'Cloud',
              readEntries: async () => [],
              operations: {
                openProject: {
                  run: ({ project }) =>
                    project.defaultFile
                      ? { defaultFile: project.defaultFile }
                      : undefined,
                },
              },
            }),
          ],
        }),
      ],
      systemIO,
      wasmPromise: Promise.resolve(wasmInstance),
    }))

    await expect(
      registry.get(homeProjectActionsService).open(remoteCloudProject)
    ).resolves.toEqual({
      defaultFile: '/cloud-projects/remote-title/main.kcl',
    })
    expect(
      cloudSyncPathMocks.getCloudProjectLibraryMaterializationDirectoryPath
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
      })
    )
    expect(cloudSync.ensureProjectLocallySynced).toHaveBeenCalledWith(
      'remote-123',
      '/cloud-projects'
    )
    expect(systemIO.send).not.toHaveBeenCalled()
  })
})
