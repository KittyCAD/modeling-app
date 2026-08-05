import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal, untracked } from '@preact/signals-core'
import {
  cloudSyncStatus,
  configureCloudSync,
  deleteCloudSyncLocalProjectRealizations,
  deleteRemoteCloudProject,
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
import { getCloudProjectLibraryMaterializationDirectoryPath } from '@src/lib/cloudSync/paths'
import {
  type CloudSyncRegistryService,
  cloudSyncService,
} from '@src/lib/cloudSync/registry/contract'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import { runtimeService } from '@src/registry/contracts/runtime'
import { settingsService } from '@src/registry/contracts/settings'

const CLOUD_SYNC_PLUGIN_ID = 'cloud-sync'

export const cloudSyncExtension = defineRegistryItemFactory((ctx) => {
  const runtimeConfig = signal<Parameters<typeof configureCloudSync>[0]>({
    enabled: false,
  })
  const settings = ctx.services.signal(settingsService)
  const runtime = ctx.services.signal(runtimeService)
  let stopSettingsSync: (() => void) | undefined
  let runtimePolicyVersion = 0

  const applyRuntimePolicy = () => {
    const version = ++runtimePolicyVersion
    const currentSettings = settings.value?.current.value
    const currentRuntime = runtime.value?.current.value
    const cloudSyncPluginEnabled =
      currentSettings?.plugins?.[CLOUD_SYNC_PLUGIN_ID]?.current === true
    const cloudProjectLibrary = currentSettings?.app.libraries.current.find(
      (library) => library.type === CLOUD_PROJECT_LIBRARY_TYPE
    )
    const runtimePolicy = {
      ...runtimeConfig.value,
      enabled: runtimeConfig.value.enabled && cloudSyncPluginEnabled,
      baseUrl: currentRuntime?.apiBaseUrl ?? runtimeConfig.value.baseUrl,
      environmentName:
        currentRuntime?.environmentName ?? runtimeConfig.value.environmentName,
    }

    if (!runtimePolicy.enabled) {
      untracked(() => configureCloudSync(runtimePolicy))
      return
    }

    void getCloudProjectLibraryMaterializationDirectoryPath(cloudProjectLibrary)
      .catch(() => undefined)
      .then((cloudProjectDirectoryPath) => {
        if (version !== runtimePolicyVersion) {
          return
        }

        untracked(() =>
          configureCloudSync({
            ...runtimePolicy,
            projectDirectoryPath:
              runtimePolicy.projectDirectoryPath ?? cloudProjectDirectoryPath,
          })
        )
      })
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
    deleteRemoteProject: deleteRemoteCloudProject,
    deleteLocalProjectRealizations: deleteCloudSyncLocalProjectRealizations,
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
        runtimePolicyVersion += 1
        stopSettingsSync?.()
        configureCloudSync({ enabled: false })
      },
    }),
  }
}, 'cloud-sync-extension')
