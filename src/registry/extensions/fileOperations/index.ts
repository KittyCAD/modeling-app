import { effect, signal } from '@preact/signals-core'
import type * as Publication from '@src/registry/extensions/fileOperations/publication'
import type { PublishCurrentProjectArgs } from '@src/registry/extensions/fileOperations/publication'
import type {
  CloudApiConfig,
  RemoteProjectSummary,
} from '@src/lib/fs-zds/cloud/types'
import { createCloudFileSystem } from '@src/lib/fs-zds/cloud'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { reportRejection } from '@src/lib/trap'

import { authService } from '@src/registry/contracts/auth'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { createMountedFileOperations } from '@src/lib/fileSystem/mounts'
import fsZds from '@src/lib/fs-zds'
import { createProjectOperations } from '@src/lib/fileSystem/projectOperations'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import {
  cloudStorageService,
  fileOperationsService,
  projectOperationsService,
} from '@src/registry/contracts/fileOperations'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/** Own the mounted filesystem runtimes and compose project operations from their primitives. */
export function createFileOperationsServices(
  paths: IZooDesignStudioFS,
  config: () => CloudApiConfig,
  wasm: () => Promise<ModuleType> = () =>
    Promise.reject(new Error('Missing WASM promise.'))
) {
  const fileSystem = createCloudFileSystem(paths, config)
  const { projects } = fileSystem
  const runtime = createFileOperationsRuntime(fileSystem, {
    atomicFileReads: true,
  })
  const localRuntime = createFileOperationsRuntime(paths)
  const mounted = createMountedFileOperations(localRuntime.operations, paths)
  const thumbnails = signal<ReadonlyMap<string, string>>(new Map())
  const thumbnailWatches = signal<ReadonlyMap<string, number>>(new Map())
  const thumbnailVersions = new Map<string, string>()
  const thumbnailRequests = new Map<string, string>()
  let disposed = false
  const thumbnailVersion = (project: RemoteProjectSummary) =>
    JSON.stringify([
      config().accountId,
      project.revision,
      project.updated_at,
      project.preview_status,
    ])
  const loadThumbnail = (project: RemoteProjectSummary) => {
    const version = thumbnailVersion(project)
    if (
      thumbnailVersions.get(project.id) === version ||
      thumbnailRequests.get(project.id) === version
    )
      return
    thumbnailRequests.set(project.id, version)
    if (thumbnails.peek().has(project.id)) {
      const next = new Map(thumbnails.peek())
      next.delete(project.id)
      thumbnails.value = next
    }
    void fileSystem
      .thumbnail(project)
      .then((url) => {
        const current = projects.peek().find((item) => item.id === project.id)
        if (
          disposed ||
          !current ||
          thumbnailVersion(current) !== version ||
          thumbnailRequests.get(project.id) !== version
        )
          return
        if (url && !thumbnailWatches.peek().has(project.id)) return
        // Remember missing thumbnails too, even if the card scrolled away.
        // Project metadata or account changes produce a new cache version.
        thumbnailVersions.set(project.id, version)
        if (url) {
          thumbnails.value = new Map(thumbnails.peek()).set(project.id, url)
        }
      })
      .catch(reportRejection)
      .finally(() => {
        if (thumbnailRequests.get(project.id) === version)
          thumbnailRequests.delete(project.id)
      })
  }
  const stopThumbnailWatcher = effect(() => {
    const watched = thumbnailWatches.value
    for (const project of projects.value)
      if (watched.has(project.id)) loadThumbnail(project)
  })
  const withFileOperations = async <T>(
    backing: IZooDesignStudioFS,
    run: (operations: FileOperationsRegistryService) => Promise<T>
  ) => {
    const scoped = createFileOperationsRuntime(backing)
    try {
      return await run(scoped.operations)
    } finally {
      await scoped.dispose()
    }
  }
  const cloud = {
    ...fileSystem,
    projects,
    thumbnails,
    watchThumbnail: (id: string) => {
      thumbnailWatches.value = new Map(thumbnailWatches.peek()).set(
        id,
        (thumbnailWatches.peek().get(id) ?? 0) + 1
      )
      let watching = true
      return () => {
        if (!watching) return
        watching = false
        const next = new Map(thumbnailWatches.peek())
        const count = (next.get(id) ?? 1) - 1
        if (count) next.set(id, count)
        else next.delete(id)
        thumbnailWatches.value = next
      }
    },
    batch: <T>(
      path: string,
      run: (operations: FileOperationsRegistryService) => Promise<T>
    ) => fileSystem.batch(path, (memory) => withFileOperations(memory, run)),
    getProjectStatus: async (id: string) =>
      (
        await import('@src/registry/extensions/fileOperations/publication')
      ).getCloudPublicationStatus(id, config().token),
    getProjectStatuses: async () =>
      (
        await import('@src/registry/extensions/fileOperations/publication')
      ).getCloudPublicationStatuses(config().token),
    downloadProjectById: async (id: string) =>
      (await import('@src/lib/fs-zds/cloud/publicProject')).downloadProjectById(
        id
      ),
    getPublicProjectNameById: async (id: string) =>
      (
        await import('@src/lib/fs-zds/cloud/publicProject')
      ).getPublicProjectNameById(id),
    publishCurrentProject: async (args: PublishCurrentProjectArgs) => {
      const id =
        args.remoteProjectId ??
        (args.project?.path ? fileSystem.idFor(args.project.path) : undefined)
      if (!id)
        return Promise.reject(
          new Error('A cloud project must be open before publishing.')
        )
      return fileSystem.withProject(id, (snapshot) =>
        withFileOperations(snapshot.backing, async (fileOperations) => {
          const publication = await import(
            '@src/registry/extensions/fileOperations/publication'
          )
          const result = await publication.publishCurrentProject({
            ...args,
            fileOperations,
            remoteProjectId: id,
            expectedRevision: String(snapshot.remote.revision),
            deletedPaths: snapshot.deletedPaths,
          })
          if (result) await snapshot.acknowledge()
          return result
        })
      )
    },
    getCurrentProjectPublicationDetails: async (
      args: Parameters<
        typeof Publication.getCurrentProjectPublicationDetails
      >[0]
    ) => {
      const publication = await import(
        '@src/registry/extensions/fileOperations/publication'
      )
      return publication.getCurrentProjectPublicationDetails(args)
    },
  }
  mounted.mount({
    root: fileSystem.root,
    operations: {
      ...runtime.operations,
      // Move may issue mkdir, rename, or copy/remove. Persist the whole operation
      // once so a failed acknowledgement cannot be mistaken for rename failure.
      move: (source: string, destination: string) =>
        fileSystem.idFor(source) !== fileSystem.idFor(destination)
          ? Promise.reject(new Error('Move cannot cross cloud projects.'))
          : fileSystem.batch(source, (memory) =>
              withFileOperations(memory, (operations) =>
                operations.move(source, destination)
              )
            ),
      pending: async () =>
        (await runtime.operations.pending()) + fileSystem.pending(),
    },
  })
  const projectOperations = createProjectOperations({
    operations: mounted.operations,
    batch: (root, run) =>
      root === fileSystem.root ||
      root.startsWith(`${fileSystem.root}${paths.sep}`)
        ? cloud.batch(root, run)
        : run(mounted.operations),
    wasm,
  })
  return {
    cloud,
    operations: mounted.operations,
    projects: projectOperations,
    dispose: async () => {
      disposed = true
      stopThumbnailWatcher()
      await fileSystem.detach()
      await runtime.dispose()
      await localRuntime.dispose()
    },
  }
}

export type CloudStorageService = ReturnType<
  typeof createFileOperationsServices
>['cloud']

export const createFileOperationsExtension = (backing: IZooDesignStudioFS) =>
  defineRegistryItemFactory((ctx) => {
    const services = createFileOperationsServices(
      backing,
      () => ({
        enabled: true,
        token: ctx.services.optional(authService)?.token.peek(),
        accountId:
          ctx.services.optional(authService)?.user.peek()?.id ||
          ctx.services.optional(authService)?.token.peek(),
      }),
      () =>
        ctx.valueSpecs.get(wasmPromiseValueSpec) ??
        Promise.reject(new Error('Missing WASM promise.'))
    )
    return {
      id: 'file-operations-extension',
      providesServices: [
        provideService(projectOperationsService, services.projects),
        provideService(cloudStorageService, services.cloud),
        provideService(fileOperationsService, services.operations),
      ],
      dispose: services.dispose,
    }
  }, 'file-operations-extension')

export const fileOperationsExtension = createFileOperationsExtension(fsZds)
export default defineRegistryItem({
  id: 'file-operations',
  uses: [fileOperationsExtension],
})
