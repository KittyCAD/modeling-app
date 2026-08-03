import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { RuntimeInfo } from '@src/registry/contracts/runtime'
import { runtimeService } from '@src/registry/contracts/runtime'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cloudSyncMocks = vi.hoisted(() => ({
  configureCloudSync: vi.fn(),
  cloudSyncStatus: {
    value: {
      enabled: false,
      state: 'disabled',
      pendingCount: 0,
    },
  },
}))

vi.mock('@src/lib/cloudSync', () => ({
  cloudSyncStatus: cloudSyncMocks.cloudSyncStatus,
  configureCloudSync: cloudSyncMocks.configureCloudSync,
  deleteCloudSyncLocalProjectRealizations: vi.fn(),
  deleteRemoteCloudProject: vi.fn(),
  ensureCloudProjectLocallySynced: vi.fn(),
  startCloudSyncProject: vi.fn(),
  disconnectCloudSyncProject: vi.fn(),
  getCloudSyncProjectMetadata: vi.fn(),
  getCloudSyncProjectMetadataIndex: vi.fn(),
  getCloudSyncProjectModifiedTime: vi.fn(),
  installCloudSyncFileSystemObserver: vi.fn(),
  resolveCloudSyncProjectConflict: vi.fn(),
  retryCloudSync: vi.fn(),
  setCloudSyncProjectScope: vi.fn(),
  getCloudSyncRemoteProjectThumbnailUrl: vi.fn(),
}))

describe('cloud sync extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    cloudSyncMocks.configureCloudSync.mockClear()
  })

  it('merges runtime policy with settings from the registry service', async () => {
    const settings = signal(
      createSettingsSnapshot({
        cloudSyncEnabled: true,
        projectDirectoryPath: '/projects',
      })
    )
    const runtime = signal(
      createRuntimeSnapshot({
        environmentName: 'dev.zoo.dev',
        apiBaseUrl: 'https://api.dev.zoo.dev',
      })
    )
    const settingsRegistryItem = defineRegistryItem({
      id: 'test.settings',
      providesServices: [
        provideService(settingsService, {
          current: settings,
          get: () => settings.value,
        } as SettingsRegistryService),
      ],
    })
    const runtimeRegistryItem = defineRegistryItem({
      id: 'test.runtime',
      providesServices: [
        provideService(runtimeService, {
          current: runtime,
          get: () => runtime.value,
          refresh: () => runtime.value,
        }),
      ],
    })
    const { cloudSyncExtension } = await import(
      '@src/lib/cloudSync/registry/extension'
    )
    const { cloudSyncService } = await import(
      '@src/lib/cloudSync/registry/contract'
    )

    registry = new Registry()
    registry.configure([
      settingsRegistryItem,
      runtimeRegistryItem,
      cloudSyncExtension,
    ])

    registry.get(cloudSyncService).configure({
      enabled: true,
      token: 'test-token',
      syncExistingLocalProjects: true,
    })

    expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
      enabled: true,
      token: 'test-token',
      syncExistingLocalProjects: true,
      baseUrl: 'https://api.dev.zoo.dev',
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: '/projects',
    })

    settings.value = createSettingsSnapshot({
      cloudSyncEnabled: false,
      projectDirectoryPath: '/other-projects',
    })

    expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
      enabled: false,
      token: 'test-token',
      syncExistingLocalProjects: true,
      baseUrl: 'https://api.dev.zoo.dev',
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: '/other-projects',
    })

    runtime.value = createRuntimeSnapshot({
      environmentName: 'prod.zoo.dev',
      apiBaseUrl: 'https://api.prod.zoo.dev',
    })

    expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
      enabled: false,
      token: 'test-token',
      syncExistingLocalProjects: true,
      baseUrl: 'https://api.prod.zoo.dev',
      environmentName: 'prod.zoo.dev',
      projectDirectoryPath: '/other-projects',
    })
  })
})

function createRuntimeSnapshot({
  environmentName,
  apiBaseUrl,
}: {
  environmentName: string
  apiBaseUrl: string
}): RuntimeInfo {
  return {
    target: 'desktop',
    hasWindow: true,
    isDesktop: true,
    isWeb: false,
    isServer: false,
    isPlaywright: false,
    environmentName,
    apiBaseUrl,
  }
}

function createSettingsSnapshot({
  cloudSyncEnabled,
  projectDirectoryPath,
}: {
  cloudSyncEnabled: boolean
  projectDirectoryPath: string
}): SettingsType {
  return {
    app: {
      libraries: {
        current: [
          {
            title: 'Projects',
            path: projectDirectoryPath,
            type: 'directory',
          },
        ],
      },
      projectDirectory: {
        current: projectDirectoryPath,
      },
    },
    plugins: {
      'cloud-sync': {
        current: cloudSyncEnabled,
      },
    },
  } as unknown as SettingsType
}
