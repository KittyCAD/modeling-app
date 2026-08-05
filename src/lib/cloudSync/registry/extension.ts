import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  pluginsValueSpec,
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
  type CloudSyncRegistryRuntimeConfig,
  type CloudSyncRegistryService,
  cloudSyncService,
} from '@src/lib/cloudSync/registry/contract'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import {
  areProjectLibrarySettingsEqual,
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultCloudProjectLibrarySetting,
  isLegacyPersonalCloudProjectLibraryPathSetting,
  isPersonalCloudProjectLibrarySetting,
  mergeProjectLibrarySettings,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import { authService } from '@src/registry/contracts/auth'
import { runtimeService } from '@src/registry/contracts/runtime'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'

const CLOUD_SYNC_PLUGIN_ID = 'cloud-sync'

type SettingsSnapshot = ReturnType<
  SettingsRegistryService['actor']['getSnapshot']
>

function normalizeProjectLibrarySettingPath(path: string) {
  return path.trim().replaceAll('\\', '/').replace(/\/+$/g, '')
}

/**
 * Enabling Cloud sync materializes the explicit Personal Cloud library row.
 *
 * Desktop keeps directory and cloud libraries side by side; web treats Personal
 * Cloud as the canonical project library and replaces only the recognized
 * default directory row.
 */
function materializePersonalCloudLibraryOnEnable(
  settings: SettingsRegistryService,
  snapshot: SettingsSnapshot,
  isWeb: boolean
) {
  if (!snapshot.matches('idle')) {
    return false
  }

  const currentLibraries = snapshot.context.app.libraries?.current ?? []
  const defaultDirectoryLibraryPaths = new Set(
    [
      snapshot.context.app.projectDirectory?.current,
      snapshot.context.app.projectDirectory?.default,
      ...(snapshot.context.app.libraries?.default ?? [])
        .filter((library) => library.type === DIRECTORY_PROJECT_LIBRARY_TYPE)
        .map((library) => library.path),
    ]
      .filter((path): path is string => Boolean(path?.trim()))
      .map(normalizeProjectLibrarySettingPath)
  )
  const defaultCloudLibrary = getDefaultCloudProjectLibrarySetting()
  const isDefaultCloudLibrary = (library: ProjectLibrarySetting) =>
    isPersonalCloudProjectLibrarySetting(library)
  const shouldReplaceDirectoryLibraryOnWeb = (library: ProjectLibrarySetting) =>
    isWeb &&
    library.type === DIRECTORY_PROJECT_LIBRARY_TYPE &&
    defaultDirectoryLibraryPaths.has(
      normalizeProjectLibrarySettingPath(library.path)
    )

  let hasPersonalCloudLibrary = false
  const nextLibraries = mergeProjectLibrarySettings(
    currentLibraries.flatMap((library) => {
      if (isDefaultCloudLibrary(library)) {
        hasPersonalCloudLibrary = true
        return [
          isLegacyPersonalCloudProjectLibraryPathSetting(library)
            ? {
                ...library,
                path: defaultCloudLibrary.path,
                ...(defaultCloudLibrary.source
                  ? { source: defaultCloudLibrary.source }
                  : {}),
              }
            : library,
        ]
      }

      if (shouldReplaceDirectoryLibraryOnWeb(library)) {
        if (hasPersonalCloudLibrary) {
          return []
        }

        hasPersonalCloudLibrary = true
        return [defaultCloudLibrary]
      }

      return [library]
    }),
    hasPersonalCloudLibrary ? [] : [defaultCloudLibrary]
  )

  if (areProjectLibrarySettingsEqual(nextLibraries, currentLibraries)) {
    return false
  }

  settings.send({
    type: 'set.app.libraries',
    data: {
      level: 'user',
      value: nextLibraries,
    },
  })
  return true
}

export const cloudSyncExtension = defineRegistryItemFactory((ctx) => {
  const runtimeConfig = signal<CloudSyncRegistryRuntimeConfig>({
    autoEnrollCloudLibraryProjects: true,
  })
  const runtime = ctx.services.signal(runtimeService)
  const auth = ctx.services.signal(authService)
  const userFeatures = ctx.services.signal(userFeaturesService)
  const plugins = ctx.valueSpecs.signal(pluginsValueSpec)
  const settingsSnapshot = signal<SettingsSnapshot | undefined>(undefined)
  let settingsRegistry: SettingsRegistryService | undefined
  let disposed = false
  let stopPolicySync: (() => void) | undefined
  let stopSettingsActorSubscription: (() => void) | undefined
  let runtimePolicyVersion = 0

  const applyRuntimePolicy = () => {
    const version = ++runtimePolicyVersion
    const currentSettings = settingsRegistry?.current.value
    const currentRuntime = runtime.value?.current.value
    const token = auth.value
      ? auth.value.token.value
      : runtimeConfig.value.token
    const cloudSyncPluginEnabled =
      currentSettings?.plugins?.[CLOUD_SYNC_PLUGIN_ID]?.current === true
    const cloudSyncFeatureEnabled =
      userFeatures.value?.has(OPFS_CLOUD_FEATURE_FLAG, false) ?? true
    const cloudProjectLibrary = currentSettings?.app.libraries.current.find(
      (library) => library.type === CLOUD_PROJECT_LIBRARY_TYPE
    )
    const runtimePolicy = {
      ...runtimeConfig.value,
      enabled:
        Boolean(token) && cloudSyncPluginEnabled && cloudSyncFeatureEnabled,
      token,
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

  const subscribeToSettingsActor = () => {
    // Library materialization depends on the settings machine state, not just
    // the current settings value, so keep the actor snapshot directly.
    const settingsActor = settingsRegistry?.actor
    if (!settingsActor) {
      return
    }

    settingsSnapshot.value = settingsActor.getSnapshot()
    const subscription = settingsActor.subscribe((snapshot) => {
      settingsSnapshot.value = snapshot
    })
    stopSettingsActorSubscription = () => subscription.unsubscribe()
  }

  const isCloudSyncPluginActive = () => {
    const cloudSyncPlugin = plugins.value.find(
      (plugin) => plugin.id === CLOUD_SYNC_PLUGIN_ID
    )
    if (!cloudSyncPlugin) {
      return false
    }

    return ctx.services.get(cloudSyncPlugin.service).active.value
  }

  const applyCloudSyncProjectLibraryPolicy = () => {
    const snapshot = settingsSnapshot.value
    const currentRuntime = runtime.value?.current.value
    if (!settingsRegistry || !snapshot || !isCloudSyncPluginActive()) {
      return
    }

    materializePersonalCloudLibraryOnEnable(
      settingsRegistry,
      snapshot,
      currentRuntime?.isWeb === true
    )
  }

  const ensurePolicySync = () => {
    if (disposed || stopPolicySync) {
      return
    }

    settingsRegistry = ctx.services.get(settingsService)
    subscribeToSettingsActor()
    stopPolicySync = effect(() => {
      applyRuntimePolicy()
      applyCloudSyncProjectLibraryPolicy()
    })
  }

  queueMicrotask(ensurePolicySync)

  const serviceImpl: CloudSyncRegistryService = {
    status: cloudSyncStatus,
    configure: (config) => {
      runtimeConfig.value = {
        ...runtimeConfig.value,
        ...config,
      }
      ensurePolicySync()
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
        disposed = true
        runtimePolicyVersion += 1
        stopPolicySync?.()
        stopSettingsActorSubscription?.()
        configureCloudSync({ enabled: false })
      },
    }),
  }
}, 'cloud-sync-extension')
