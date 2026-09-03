import {
  createPlugin,
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type * as ClientErrors from '@src/lib/clientErrors'
import { CLOUD_SYNC_PLUGIN_ID } from '@src/lib/cloudSync/registry/constants'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DEFAULT_PROJECT_LIBRARY_ID,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultCloudProjectLibrarySetting,
  getDefaultProjectLibrarySettings,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import projectLibrariesExtension from '@src/lib/projectLibraries/registry'
import type {
  CloudProjectRelationship,
  CloudSyncRegistryService,
} from '@src/registry/contracts/cloudSync'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectEntry,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import {
  type ProjectLibraryRealization,
  type ProjectLibraryRealizationContribution,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import {
  type SystemIORegistryService,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import homeProjectsExtension, {
  deriveHomeProjectEntryContributions,
} from '@src/registry/extensions/homeProjects'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function projectNameFromPath(projectPath: string) {
  return projectPath.slice(projectPath.lastIndexOf('/') + 1)
}

const desktopMocks = vi.hoisted(() => ({
  getProjectInfo: vi.fn(),
}))

const cloudSyncPathMocks = vi.hoisted(() => ({
  getCloudProjectLibraryMaterializationDirectoryPath: vi.fn(
    async (library: { path: string }) => library.path
  ),
}))

const clientErrorMocks = vi.hoisted(() => ({
  reportClientError: vi.fn(),
}))

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const original = await importOriginal<typeof ClientErrors>()
  return {
    ...original,
    reportClientError: clientErrorMocks.reportClientError,
  }
})

const fsZdsMocks = vi.hoisted(() => {
  const join = (...parts: string[]) => {
    let joinedPath = ''
    for (const part of parts) {
      if (!part) {
        continue
      }
      if (!joinedPath) {
        joinedPath = part
        continue
      }
      joinedPath = `${joinedPath.replace(/\/+$/g, '')}/${part.replace(
        /^\/+/g,
        ''
      )}`
    }

    return joinedPath.replace(/\/$/g, '')
  }
  const dirname = (path: string) => {
    const normalizedPath = path.replace(/\/+$/g, '')
    const lastSeparatorIndex = normalizedPath.lastIndexOf('/')

    if (lastSeparatorIndex <= 0) {
      return '/'
    }

    return normalizedPath.slice(0, lastSeparatorIndex)
  }

  return {
    basename: vi.fn((path: string) => path.slice(path.lastIndexOf('/') + 1)),
    dirname: vi.fn(dirname),
    join: vi.fn(join),
    readdir: vi.fn(),
    rename: vi.fn(),
    rm: vi.fn(),
    sep: '/',
    stat: vi.fn(),
  }
})

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

vi.mock('@src/lib/fs-zds', () => ({
  default: fsZdsMocks,
}))

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
    syncNow: vi.fn().mockResolvedValue({ remoteProjectId: 'remote-123' }),
    disconnectProjectSync: vi.fn().mockResolvedValue(undefined),
    deleteRemoteProject: vi.fn().mockResolvedValue(undefined),
    deleteLocalProjectRealizations: vi.fn().mockResolvedValue(undefined),
    deleteDuplicateProjectRealizations: vi.fn().mockResolvedValue(undefined),
    ensureProjectLocallySynced: vi.fn().mockResolvedValue(undefined),
    getRemoteProjectThumbnailUrl: vi.fn().mockResolvedValue(undefined),
    getProjectMetadata: vi.fn().mockResolvedValue(undefined),
    getProjectMetadataIndex: vi.fn().mockResolvedValue(new Map()),
    getProjectModifiedTime: vi.fn((_metadata, localModified) => localModified),
    resolveProjectConflict: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function realization(
  overrides: Partial<ProjectLibraryRealization> & { localProjectPath: string }
): ProjectLibraryRealization {
  const { localProjectPath, ...rest } = overrides
  const localProjectName = projectNameFromPath(localProjectPath)

  return {
    id: `local:${localProjectPath}`,
    libraryIds: ['default-project-directory'],
    libraryRefs: [
      {
        id: 'default-project-directory',
        title: 'Projects',
        path: '/projects',
        type: 'directory',
      },
    ],
    localProjectPath,
    localProjectName,
    name: localProjectName,
    readWriteAccess: true,
    ...rest,
  }
}

function cloudRelationship(
  overrides: Partial<CloudProjectRelationship> & { remoteProjectId: string }
): CloudProjectRelationship {
  const { remoteProjectId, ...rest } = overrides
  return {
    id: `cloud:${remoteProjectId}`,
    remoteProjectId,
    duplicateRealizations: [],
    localRealizations: [],
    ...rest,
  }
}

describe('deriveHomeProjectEntryContributions', () => {
  it('derives local-only realization cards', () => {
    expect(
      deriveHomeProjectEntryContributions({
        realizations: [
          realization({
            localProjectPath: '/projects/local-project',
            title: 'Local Project',
          }),
        ],
        cloudRelationships: [],
      })
    ).toEqual([
      expect.objectContaining({
        source: 'local',
        status: 'local',
        name: 'local-project',
        title: 'Local Project',
        localProjectPath: '/projects/local-project',
      }),
    ])
  })

  it('derives remote-only cloud relationship cards', () => {
    expect(
      deriveHomeProjectEntryContributions({
        realizations: [],
        cloudRelationships: [
          cloudRelationship({
            remoteProjectId: 'remote-123',
            remoteProject: {
              id: 'remote-123',
              title: 'Remote Project',
            },
          }),
        ],
      })
    ).toEqual([
      expect.objectContaining({
        id: 'cloud:remote-123',
        source: 'remote',
        status: 'cloud-only',
        name: 'Remote Project',
        title: 'Remote Project',
        libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
        remoteProjectId: 'remote-123',
      }),
    ])
  })

  it('derives one canonical relationship card with duplicate metadata attached', () => {
    const canonical = realization({
      localProjectPath: '/cloud/bracket',
      cloudProjectId: 'remote-123',
      libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
      libraryRefs: [
        {
          id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          title: 'Personal Cloud',
          path: '/cloud',
          type: CLOUD_PROJECT_LIBRARY_TYPE,
        },
      ],
    })
    const duplicate = realization({
      localProjectPath: '/projects/bracket-copy',
      cloudProjectId: 'remote-123',
    })

    expect(
      deriveHomeProjectEntryContributions({
        realizations: [canonical, duplicate],
        cloudRelationships: [
          cloudRelationship({
            remoteProjectId: 'remote-123',
            canonicalRealization: {
              role: 'canonical',
              realization: canonical,
              duplicateRisk: 'exact',
              autoCleanupEligible: false,
            },
            duplicateRealizations: [
              {
                role: 'duplicate',
                realization: duplicate,
                duplicateRisk: 'exact',
                autoCleanupEligible: false,
              },
            ],
            localRealizations: [
              {
                role: 'canonical',
                realization: canonical,
                duplicateRisk: 'exact',
                autoCleanupEligible: false,
              },
              {
                role: 'duplicate',
                realization: duplicate,
                duplicateRisk: 'exact',
                autoCleanupEligible: false,
              },
            ],
          }),
        ],
      })
    ).toEqual([
      expect.objectContaining({
        id: 'cloud:remote-123',
        source: 'local',
        status: 'synced',
        libraryIds: [
          PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          DEFAULT_PROJECT_LIBRARY_ID,
        ],
        localProjectPath: '/cloud/bracket',
        remoteProjectId: 'remote-123',
        duplicateRealizations: [
          expect.objectContaining({
            localProjectPath: '/projects/bracket-copy',
            duplicateRisk: 'exact',
          }),
        ],
      }),
    ])
  })

  it('keeps duplicate realizations as separate cards without an explicit cloud relationship', () => {
    expect(
      deriveHomeProjectEntryContributions({
        realizations: [
          realization({
            localProjectPath: '/projects/bracket',
            cloudProjectId: 'remote-123',
          }),
          realization({
            localProjectPath: '/cloud/bracket',
            cloudProjectId: 'remote-123',
          }),
        ],
        cloudRelationships: [],
      })
    ).toEqual([
      expect.objectContaining({
        localProjectPath: '/projects/bracket',
        remoteProjectId: 'remote-123',
      }),
      expect.objectContaining({
        localProjectPath: '/cloud/bracket',
        remoteProjectId: 'remote-123',
      }),
    ])
  })
})

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

  it('discovers default directory entries through project library scanning', async () => {
    const wasmPromise = Promise.resolve({} as never)
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
    const settings = createMutableSettingsService({
      libraries: getDefaultProjectLibrarySettings('/projects'),
    })
    const systemIO = createSystemIOService()
    const cloudSync = createCloudSyncService()
    fsZdsMocks.readdir.mockResolvedValue(['local-project'])
    fsZdsMocks.stat.mockResolvedValue({
      mode: fsZdsConstants.S_IFDIR,
      mtimeMs: 100,
    })
    desktopMocks.getProjectInfo.mockResolvedValue(project)

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
        id: 'test.wasm',
        provides: [provideWasmPromise(wasmPromise)],
      }),
      projectLibrariesExtension,
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
    expect(desktopMocks.getProjectInfo).toHaveBeenCalledWith(
      '/projects/local-project',
      await wasmPromise
    )
  })

  it('reports configured directory project delete failures as destructive', async () => {
    const deleteError = new Error('Project delete failed')
    const systemIO = createSystemIOService()
    const cloudSync = createCloudSyncService()
    const removeSpy = vi.spyOn(fsZds, 'rm').mockRejectedValue(deleteError)
    const library = {
      id: 'directory:/projects',
      title: 'Projects',
      path: '/projects',
      type: DIRECTORY_PROJECT_LIBRARY_TYPE,
    } satisfies ProjectLibrary
    const project = {
      id: 'local:/projects/at-risk',
      source: 'local',
      status: 'local',
      libraryIds: [library.id],
      name: 'at-risk',
      title: 'At Risk',
      localProjectName: 'at-risk',
      localProjectPath: '/projects/at-risk',
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
                {
                  title: library.title,
                  path: library.path,
                  type: library.type,
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
        id: 'test.wasm',
        provides: [provideWasmPromise(Promise.resolve({} as never))],
      }),
      projectLibrariesExtension,
      homeProjectsExtension,
    ])

    const deleteProject = registry
      .get(projectLibraryTypesValueSpec)
      .get(DIRECTORY_PROJECT_LIBRARY_TYPE)?.operations?.deleteProject
    expect(deleteProject).toBeDefined()
    await expect(deleteProject?.run({ library, project })).rejects.toBe(
      deleteError
    )

    expect(removeSpy).toHaveBeenCalledWith('/projects/at-risk', {
      recursive: true,
    })
    expect(clientErrorMocks.reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'system_io_error',
        errorName: 'Error',
        message: 'SystemIO destructive operation failed during delete project.',
        extra: expect.objectContaining({
          source: 'DirectoryProjectLibrary',
          operation: 'delete project',
          risk: 'destructive',
          errorType: 'Error',
        }),
      })
    )
    expect(
      JSON.stringify(clientErrorMocks.reportClientError.mock.calls[0])
    ).not.toContain('/projects/at-risk')
  })

  it('does not report missing WASM registry configuration as a SystemIO failure', async () => {
    const systemIO = createSystemIOService()
    const cloudSync = createCloudSyncService()
    const library = {
      id: 'directory:/projects',
      title: 'Projects',
      path: '/projects',
      type: DIRECTORY_PROJECT_LIBRARY_TYPE,
    } satisfies ProjectLibrary

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
                  title: library.title,
                  path: library.path,
                  type: library.type,
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
      projectLibrariesExtension,
      homeProjectsExtension,
    ])

    const createProject = registry
      .get(projectLibraryTypesValueSpec)
      .get(DIRECTORY_PROJECT_LIBRARY_TYPE)?.operations?.createProject
    if (!createProject) {
      throw new Error('Expected directory create project operation')
    }

    await expect(
      createProject.run({
        library,
        requestedProjectName: 'new-project',
        requestedProjectTitle: 'New Project',
      })
    ).rejects.toThrow('Missing WASM promise registry value.')
    expect(clientErrorMocks.reportClientError).not.toHaveBeenCalled()
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
    const readRealizations = vi.fn(({ library }: { library: ProjectLibrary }) =>
      Promise.resolve([
        {
          library,
          name: 'untitled-43',
          title: 'untitled-43',
          localProjectPath: '/custom-cloud/untitled-43',
          localProjectName: 'untitled-43',
          cloudProjectId: 'remote-123',
          defaultFile: '/custom-cloud/untitled-43/main.kcl',
          readWriteAccess: true,
          thumbnail: {
            type: 'local',
            path: '/custom-cloud/untitled-43/thumbnail.png',
          },
        },
      ] satisfies ProjectLibraryRealizationContribution[])
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
            readRealizations,
          }),
        ],
      }),
      projectLibrariesExtension,
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

    readRealizations.mockClear()
    settings.current.value = {
      ...settings.current.value,
      unrelated: {
        value: 1,
      },
    }
    await Promise.resolve()
    await Promise.resolve()

    expect(readRealizations).not.toHaveBeenCalled()
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
            readRealizations: async () => [],
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
      source: 'local',
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
            readRealizations: async () => [],
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

  it.each([
    {
      name: 'uses cloudSync cleanup for a linked directory project when the plugin is active',
      pluginActive: true,
    },
    {
      name: 'deletes a linked directory project normally when the plugin is inactive',
      pluginActive: false,
    },
  ])('$name', async ({ pluginActive }) => {
    const systemIO = createSystemIOService()
    const cloudSync = createCloudSyncService({
      status: signal(
        pluginActive
          ? { enabled: true, state: 'idle', pendingCount: 0 }
          : { enabled: false, state: 'disabled', pendingCount: 0 }
      ),
    })
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
      createPlugin({
        id: CLOUD_SYNC_PLUGIN_ID,
        title: 'Cloud sync',
        description: 'Test cloud sync plugin.',
        items: [],
        enabledByDefault: pluginActive,
      }),
      projectLibrariesExtension,
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
        source: 'local',
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

    if (pluginActive) {
      expect(cloudSync.deleteLocalProjectRealizations).toHaveBeenCalledWith(
        'remote-123',
        '/projects/bracket'
      )
      expect(removeProjectDirectory).not.toHaveBeenCalled()
    } else {
      expect(cloudSync.deleteLocalProjectRealizations).not.toHaveBeenCalled()
      expect(removeProjectDirectory).toHaveBeenCalledWith('/projects/bracket', {
        recursive: true,
      })
    }
    expect(cloudSync.deleteRemoteProject).not.toHaveBeenCalled()
  })
})
