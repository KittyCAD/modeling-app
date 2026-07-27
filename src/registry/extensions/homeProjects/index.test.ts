import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CloudSyncRegistryService } from '@src/registry/contracts/cloudSync'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectEntry,
  homeProjectActionsService,
} from '@src/registry/contracts/homeProjects'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import {
  type SystemIORegistryService,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import homeProjectsExtension from '@src/registry/extensions/homeProjects'
import { afterEach, describe, expect, it, vi } from 'vitest'

const desktopMocks = vi.hoisted(() => ({
  getProjectInfo: vi.fn(),
}))

const cloudSyncPathMocks = vi.hoisted(() => ({
  getDefaultCloudProjectDirectoryPath: vi.fn(),
}))

vi.mock('@src/lib/desktop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/lib/desktop')>()
  return {
    ...actual,
    getProjectInfo: desktopMocks.getProjectInfo,
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

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    vi.restoreAllMocks()
  })

  it('opens remote-only cloud projects without forcing a full folder rescan', async () => {
    const wasmInstance = {} as ModuleType
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
})
