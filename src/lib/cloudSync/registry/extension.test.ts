import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'
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
const cloudSyncPathMocks = vi.hoisted(() => ({
  getCloudProjectLibraryMaterializationDirectoryPath: vi.fn(
    async (library: { path: string; source?: string } | undefined) =>
      library?.path ?? '/cloud-personal'
  ),
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

vi.mock('@src/lib/cloudSync/paths', () => ({
  getCloudProjectLibraryMaterializationDirectoryPath:
    cloudSyncPathMocks.getCloudProjectLibraryMaterializationDirectoryPath,
}))

describe('cloud sync extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    cloudSyncMocks.configureCloudSync.mockClear()
    cloudSyncPathMocks.getCloudProjectLibraryMaterializationDirectoryPath.mockClear()
  })

  it('uses the configured cloud project library materialization directory for runtime policy', async () => {
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

    registry.get(cloudSyncService).configure({
      enabled: true,
      token: 'test-token',
      autoEnrollCloudLibraryProjects: true,
    })

    await vi.waitFor(() => {
      expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
        enabled: true,
        token: 'test-token',
        autoEnrollCloudLibraryProjects: true,
        projectDirectoryPath: '/cloud-personal',
      })
    })
    const resolvedCloudLibrary =
      cloudSyncPathMocks.getCloudProjectLibraryMaterializationDirectoryPath.mock.calls.at(
        -1
      )?.[0]
    expect(
      cloudSyncPathMocks.getCloudProjectLibraryMaterializationDirectoryPath
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: '/cloud-personal',
        type: 'cloud',
      })
    )
    expect(resolvedCloudLibrary?.source).toBeUndefined()

    settings.value = createSettingsSnapshot({
      cloudSyncEnabled: true,
      projectDirectoryPath: '/other-projects',
      cloudLibraryPath: '/team-cloud',
    })

    await vi.waitFor(() => {
      expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
        enabled: true,
        token: 'test-token',
        autoEnrollCloudLibraryProjects: true,
        projectDirectoryPath: '/team-cloud',
      })
    })

    settings.value = createSettingsSnapshot({
      cloudSyncEnabled: false,
      projectDirectoryPath: '/disabled-projects',
      cloudLibraryPath: '/disabled-cloud',
    })

    expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
      enabled: false,
      token: 'test-token',
      autoEnrollCloudLibraryProjects: true,
    })
  })
})

function createSettingsSnapshot({
  cloudSyncEnabled,
  projectDirectoryPath,
  cloudLibraryPath = '/cloud-personal',
  cloudLibrarySource,
}: {
  cloudSyncEnabled: boolean
  projectDirectoryPath: string
  cloudLibraryPath?: string
  cloudLibrarySource?: string
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
          {
            title: 'Personal Cloud',
            path: cloudLibraryPath,
            ...(cloudLibrarySource ? { source: cloudLibrarySource } : {}),
            type: 'cloud',
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
