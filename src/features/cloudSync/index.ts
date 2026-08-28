import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { authService } from '@src/contracts/auth'
import { cloudSyncService } from '@src/contracts/cloudSync'
import { commandsValueSpec } from '@src/contracts/commands'
import { fileSystemService } from '@src/contracts/fileSystem'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import { runtimeService } from '@src/contracts/runtime'
import { createCloudApi } from '@src/features/cloudSync/cloudApi'
import { createCloudSyncService } from '@src/features/cloudSync/createCloudSyncService'
import { CLOUD_LIBRARY_TYPE } from '@src/lib/projectLibraries'

/** Cloud archive replication, provided independently of the Cloud library UI. */
export default defineRegistryItemFactory((ctx) => {
  let service: ReturnType<typeof createCloudSyncService> | null = null
  const get = () => {
    if (service) return service
    const auth = ctx.services.get(authService)
    service = createCloudSyncService({
      fileSystem: ctx.services.get(fileSystemService),
      token: auth.token,
      api: createCloudApi({ token: () => auth.token.value }),
      backgroundIntervalMs: ctx.services.get(runtimeService).info.value.isTest
        ? 0
        : undefined,
    })
    return service
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloudSync',
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
      provides: [
        provide(commandsValueSpec, {
          id: 'cloudSync.sync',
          title: 'Sync cloud libraries',
          category: 'Project',
          icon: 'refresh',
          run: async () => {
            const libraries = ctx.services.get(projectLibrariesService)
            await Promise.all(
              libraries.libraries.value
                .filter((library) => library.type === CLOUD_LIBRARY_TYPE)
                .map((library) => get().syncLibrary(library))
            )
            await libraries.refresh()
          },
        }),
      ],
    }),
  }
}, 'cloudSync')
