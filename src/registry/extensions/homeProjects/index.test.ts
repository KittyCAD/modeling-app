import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { cloudSyncProjectLibraryType } from '@src/lib/cloudSync/registry/plugin'
import {
  getDefaultCloudProjectLibrarySetting,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
} from '@src/lib/projectLibraries'
import type { CloudSyncRegistryService } from '@src/registry/contracts/cloudSync'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectEntry,
  homeProjectActionsService,
} from '@src/registry/contracts/homeProjects'
import { projectLibrariesValueSpec } from '@src/registry/contracts/projectLibraries'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import {
  type SystemIORegistryService,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import homeProjectsExtension from '@src/registry/extensions/homeProjects'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const desktopMocks = vi.hoisted(() => ({
  getProjectInfo: vi.fn(),
}))

const cloudSyncPathMocks = vi.hoisted(() => ({
  getDefaultCloudProjectDirectoryPath: vi.fn(),
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
  getDefaultCloudProjectDirectoryPath:
    cloudSyncPathMocks.getDefaultCloudProjectDirectoryPath,
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
    setProjectScope: vi.fn(),
    startProjectSync: vi.fn().mockResolvedValue(undefined),
    disconnectProjectSync: vi.fn().mockResolvedValue(undefined),
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
    cloudSyncPathMocks.getDefaultCloudProjectDirectoryPath.mockResolvedValue(
      '/cloud-projects'
    )
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
      defineRegistryItem({
        id: 'test.wasm',
        provides: [provideWasmPromise(wasmPromise)],
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
          provideService(settingsService, createSettingsService()),
        ],
      }),
      defineRegistryItem({
        id: 'test.cloud-library',
        provides: [
          provide(projectLibrariesValueSpec, {
            ...getDefaultCloudProjectLibrarySetting(),
            id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          }),
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
      cloudSyncProjectLibraryType,
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
})
