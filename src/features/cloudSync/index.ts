import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  pluginsValueSpec,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { createAppPlugin } from '@src/app/createAppPlugin'
import { authService } from '@src/contracts/auth'
import { cloudSyncService } from '@src/contracts/cloudSync'
import { commandsValueSpec } from '@src/contracts/commands'
import { fileSystemService } from '@src/contracts/fileSystem'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import { runtimeService } from '@src/contracts/runtime'
import { booleanSetting, settingsService } from '@src/contracts/settings'
import { createCloudApi } from '@src/features/cloudSync/cloudApi'
import { installCloudLibraryActivationPolicy } from '@src/features/cloudSync/cloudLibraryActivationPolicy'
import { createCloudSyncService } from '@src/features/cloudSync/createCloudSyncService'
import { CLOUD_LIBRARY_TYPE } from '@src/lib/projectLibraries'

export const CLOUD_SYNC_PLUGIN_ID = 'cloudSync'

export const cloudSyncPluginSetting = booleanSetting({
  id: `plugins.${CLOUD_SYNC_PLUGIN_ID}`,
  section: 'plugins',
  title: 'Cloud sync',
  description: 'Synchronize projects in Personal Cloud with your Zoo account.',
  order: 0,
  defaultValue: false,
  levels: ['user'],
  platforms: ['desktop'],
  toml: ['settings', 'plugins', 'cloud_sync'],
})

/** Always-on service extension containing the synchronization engine itself. */
const cloudSyncExtension = defineRegistryItemFactory((ctx) => {
  let service: ReturnType<typeof createCloudSyncService> | null = null
  const get = () => {
    if (service) return service
    const auth = ctx.services.get(authService)
    const plugin = ctx.valueSpecs
      .get(pluginsValueSpec)
      .find((candidate) => candidate.id === CLOUD_SYNC_PLUGIN_ID)
    const active = plugin
      ? ctx.services.get(plugin.service).active
      : computed(() => false)

    service = createCloudSyncService({
      fileSystem: ctx.services.get(fileSystemService),
      token: auth.token,
      enabled: active,
      api: createCloudApi({ token: () => auth.token.value }),
      backgroundIntervalMs: ctx.services.get(runtimeService).info.value.isTest
        ? 0
        : undefined,
    })
    return service
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloudSync.extension',
      dispose: () => service?.dispose(),
      providesServices: [
        provideService(cloudSyncService, {
          get status() {
            return get().status
          },
          get remoteProjects() {
            return get().remoteProjects
          },
          syncLibrary: (library) => get().syncLibrary(library),
          syncProject: (library, path) => get().syncProject(library, path),
          relocateProject: (library, from, to) =>
            get().relocateProject(library, from, to),
          deleteProject: (library, path) => get().deleteProject(library, path),
          disconnectProject: (library, path) =>
            get().disconnectProject(library, path),
          remoteProjectId: (library, path) =>
            get().remoteProjectId(library, path),
          resolveConflict: (library, path, resolution) =>
            get().resolveConflict(library, path, resolution),
          dispose: () => get().dispose(),
        }),
      ],
    }),
  }
}, 'cloudSync.extension')

/**
 * Opt-in Cloud behavior.
 *
 * Entering the plugin slot materializes Personal Cloud once both platform
 * paths are known. Leaving the slot stops this policy, but does not unregister
 * the library type or synchronization service extension.
 */
const cloudSyncBehavior = defineRegistryItemFactory((ctx) => {
  let stop: (() => void) | undefined
  let disposed = false

  queueMicrotask(() => {
    if (disposed) return
    const libraries = ctx.services.get(projectLibrariesService)
    const fileSystem = ctx.services.get(fileSystemService)
    const runtime = ctx.services.get(runtimeService)
    const auth = ctx.services.get(authService)
    const settings = ctx.services.get(settingsService)
    stop = installCloudLibraryActivationPolicy({
      libraries,
      fileSystem,
      runtime,
      auth,
      settings,
      activationSetting: cloudSyncPluginSetting,
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloudSync.behavior',
      dispose: () => {
        disposed = true
        stop?.()
      },
      provides: [
        provide(commandsValueSpec, {
          id: 'cloudSync.sync',
          title: 'Sync cloud libraries',
          category: 'Project',
          icon: 'refresh',
          run: async () => {
            const libraries = ctx.services.get(projectLibrariesService)
            const sync = ctx.services.get(cloudSyncService)
            await Promise.all(
              libraries.libraries.value
                .filter((library) => library.type === CLOUD_LIBRARY_TYPE)
                .map((library) => sync.syncLibrary(library))
            )
            await libraries.refresh()
          },
        }),
      ],
    }),
  }
}, 'cloudSync.behavior')

const cloudSyncPlugin = createAppPlugin({
  id: CLOUD_SYNC_PLUGIN_ID,
  title: 'Cloud sync',
  description: 'Synchronize projects in Personal Cloud with your Zoo account.',
  items: [cloudSyncBehavior],
  enabledByDefault: false,
  activation: {
    forceEnabledOn: ['web'],
    settingDefinition: cloudSyncPluginSetting,
  },
})

export default defineRegistryItem({
  id: 'cloudSync',
  uses: [cloudSyncExtension, cloudSyncPlugin],
})
