import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal, untracked } from '@preact/signals-core'
import {
  cloudSyncStatus,
  configureCloudSync,
  disconnectCloudSyncProject,
  ensureCloudProjectLocallySynced,
  getCloudSyncProjectMetadata,
  getCloudSyncProjectMetadataIndex,
  getCloudSyncProjectModifiedTime,
  getCloudSyncRemoteProjectThumbnailUrl,
  installCloudSyncFileSystemObserver,
  resolveCloudSyncProjectConflict,
  retryCloudSync,
  setCloudSyncProjectScope,
  startCloudSyncProject,
} from '@src/lib/cloudSync'
import {
  type CloudSyncRegistryService,
  cloudSyncService,
} from '@src/lib/cloudSync/registry/contract'
import { getDefaultDirectoryProjectLibraryPath } from '@src/lib/projectLibraries'
import { settingsService } from '@src/registry/contracts/settings'

const CLOUD_SYNC_PLUGIN_ID = 'cloud-sync'

export const cloudSyncExtension = defineRegistryItemFactory((ctx) => {
  const runtimeConfig = signal<Parameters<typeof configureCloudSync>[0]>({
    enabled: false,
  })
  const settings = ctx.services.signal(settingsService)
  let stopSettingsSync: (() => void) | undefined

  const applyRuntimePolicy = () => {
    const currentSettings = settings.value?.current.value
    const cloudSyncPluginEnabled =
      currentSettings?.plugins?.[CLOUD_SYNC_PLUGIN_ID]?.current === true
    const nextConfig = {
      ...runtimeConfig.value,
      enabled: runtimeConfig.value.enabled && cloudSyncPluginEnabled,
      projectDirectoryPath: currentSettings
        ? getDefaultDirectoryProjectLibraryPath(
            currentSettings.app.libraries.current
          )
        : undefined,
    }

    untracked(() => configureCloudSync(nextConfig))
  }

  const ensureSettingsSync = () => {
    if (stopSettingsSync) {
      return
    }

    stopSettingsSync = effect(applyRuntimePolicy)
  }

  const serviceImpl: CloudSyncRegistryService = {
    status: cloudSyncStatus,
    configure: (config) => {
      runtimeConfig.value = {
        ...runtimeConfig.value,
        ...config,
      }
      ensureSettingsSync()
    },
    installFileSystemObserver: installCloudSyncFileSystemObserver,
    retry: retryCloudSync,
    setProjectScope: setCloudSyncProjectScope,
    startProjectSync: startCloudSyncProject,
    disconnectProjectSync: disconnectCloudSyncProject,
    ensureProjectLocallySynced: ensureCloudProjectLocallySynced,
    getProjectMetadata: getCloudSyncProjectMetadata,
    getProjectMetadataIndex: getCloudSyncProjectMetadataIndex,
    getProjectModifiedTime: getCloudSyncProjectModifiedTime,
    resolveProjectConflict: resolveCloudSyncProjectConflict,
    getRemoteProjectThumbnailUrl: getCloudSyncRemoteProjectThumbnailUrl,
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync-extension',
      providesServices: [provideService(cloudSyncService, serviceImpl)],
      dispose: () => {
        stopSettingsSync?.()
        configureCloudSync({ enabled: false })
      },
    }),
  }
}, 'cloud-sync-extension')
