import type { Feature } from '@kittycad/lib'
import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { AuthRegistryService } from '@src/registry/contracts/auth'
import { authService } from '@src/registry/contracts/auth'
import type { RuntimeInfo } from '@src/registry/contracts/runtime'
import { runtimeService } from '@src/registry/contracts/runtime'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import type { UserFeaturesRegistryService } from '@src/registry/contracts/userFeatures'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
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
  deleteCloudSyncDuplicateProjectRealizations: vi.fn(),
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
  setCloudSyncOpenedProject: vi.fn(),
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

  it('uses cloud project library materialization directories for runtime policy', async () => {
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
      token: 'test-token',
      autoEnrollCloudLibraryProjects: true,
    })

    await vi.waitFor(() => {
      expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
        enabled: true,
        token: 'test-token',
        autoEnrollCloudLibraryProjects: true,
        baseUrl: 'https://api.dev.zoo.dev',
        environmentName: 'dev.zoo.dev',
        cloudProjectDirectoryPaths: ['/cloud-personal'],
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
      cloudLibraryPaths: ['/team-cloud', '/org-cloud'],
    })

    await vi.waitFor(() => {
      expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
        enabled: true,
        token: 'test-token',
        autoEnrollCloudLibraryProjects: true,
        baseUrl: 'https://api.dev.zoo.dev',
        environmentName: 'dev.zoo.dev',
        cloudProjectDirectoryPaths: ['/team-cloud', '/org-cloud'],
      })
    })
    expect(
      cloudSyncPathMocks.getCloudProjectLibraryMaterializationDirectoryPath
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/org-cloud',
        type: 'cloud',
      })
    )

    settings.value = createSettingsSnapshot({
      cloudSyncEnabled: false,
      projectDirectoryPath: '/disabled-projects',
      cloudLibraryPath: '/disabled-cloud',
    })

    expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
      enabled: false,
      token: 'test-token',
      autoEnrollCloudLibraryProjects: true,
      baseUrl: 'https://api.dev.zoo.dev',
      environmentName: 'dev.zoo.dev',
    })

    runtime.value = createRuntimeSnapshot({
      environmentName: 'prod.zoo.dev',
      apiBaseUrl: 'https://api.prod.zoo.dev',
    })

    expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
      enabled: false,
      token: 'test-token',
      autoEnrollCloudLibraryProjects: true,
      baseUrl: 'https://api.prod.zoo.dev',
      environmentName: 'prod.zoo.dev',
    })
  })

  it('derives runtime enablement from registry auth and user feature services', async () => {
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
    const token = signal('test-token')
    const featureEnabled = signal(false)
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
    const authRegistryItem = defineRegistryItem({
      id: 'test.auth',
      providesServices: [
        provideService(authService, {
          token,
        } as AuthRegistryService),
      ],
    })
    const userFeaturesRegistryItem = defineRegistryItem({
      id: 'test.user-features',
      providesServices: [
        provideService(userFeaturesService, {
          has: (featureFlagId: Feature, defaultValue: boolean) =>
            featureFlagId === OPFS_CLOUD_FEATURE_FLAG
              ? featureEnabled.value
              : defaultValue,
        } as UserFeaturesRegistryService),
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
      authRegistryItem,
      userFeaturesRegistryItem,
      cloudSyncExtension,
    ])
    registry.get(cloudSyncService)

    await vi.waitFor(() => {
      expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
        enabled: false,
        autoEnrollCloudLibraryProjects: true,
        token: 'test-token',
        baseUrl: 'https://api.dev.zoo.dev',
        environmentName: 'dev.zoo.dev',
      })
    })

    featureEnabled.value = true

    await vi.waitFor(() => {
      expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
        enabled: true,
        autoEnrollCloudLibraryProjects: true,
        token: 'test-token',
        baseUrl: 'https://api.dev.zoo.dev',
        environmentName: 'dev.zoo.dev',
        cloudProjectDirectoryPaths: ['/cloud-personal'],
      })
    })

    token.value = ''

    await vi.waitFor(() => {
      expect(cloudSyncMocks.configureCloudSync).toHaveBeenLastCalledWith({
        enabled: false,
        autoEnrollCloudLibraryProjects: true,
        token: '',
        baseUrl: 'https://api.dev.zoo.dev',
        environmentName: 'dev.zoo.dev',
      })
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
  cloudLibraryPath = '/cloud-personal',
  cloudLibraryPaths,
  cloudLibrarySource,
}: {
  cloudSyncEnabled: boolean
  projectDirectoryPath: string
  cloudLibraryPath?: string
  cloudLibraryPaths?: string[]
  cloudLibrarySource?: string
}): SettingsType {
  const resolvedCloudLibraryPaths = cloudLibraryPaths ?? [cloudLibraryPath]

  return {
    app: {
      libraries: {
        current: [
          {
            title: 'Projects',
            path: projectDirectoryPath,
            type: 'directory',
          },
          ...resolvedCloudLibraryPaths.map((path, index) => ({
            title: index === 0 ? 'Personal Cloud' : `Cloud ${index + 1}`,
            path,
            ...(index === 0 && cloudLibrarySource
              ? { source: cloudLibrarySource }
              : {}),
            type: 'cloud',
          })),
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
