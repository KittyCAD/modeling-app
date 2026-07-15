import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'
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
    const settingsRegistryItem = defineRegistryItem({
      id: 'test.settings',
      providesServices: [
        provideService(settingsService, {
          current: settings,
          get: () => settings.value,
        } as SettingsRegistryService),
      ],
    })
    const { cloudSyncExtension } = await import(
      '@src/lib/cloudSync/registry/extension'
    )
    const { cloudSyncService } = await import(
      '@src/lib/cloudSync/registry/contract'
    )

    registry = new Registry()
    registry.configure([settingsRegistryItem, cloudSyncExtension])

    expect(registry.get(projectLibraryTypesValueSpec).get('cloud')).toEqual(
      expect.objectContaining({
        type: 'cloud',
        title: 'Cloud',
        icon: 'network',
      })
    )

    registry.get(cloudSyncService).configure({
      enabled: true,
      token: 'test-token',
      syncExistingLocalProjects: true,
    })

    expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
      enabled: true,
      token: 'test-token',
      syncExistingLocalProjects: true,
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
      projectDirectoryPath: '/other-projects',
    })
  })
})

function createSettingsSnapshot({
  cloudSyncEnabled,
  projectDirectoryPath,
}: {
  cloudSyncEnabled: boolean
  projectDirectoryPath: string
}): SettingsType {
  return {
    app: {
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
