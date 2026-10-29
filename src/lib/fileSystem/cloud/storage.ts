import { effect, signal } from '@preact/signals-core'
import type * as Publication from '@src/lib/fileSystem/cloud/publication'
import type { PublishCurrentProjectArgs } from '@src/lib/fileSystem/cloud/publication'
import * as api from '@src/lib/fileSystem/cloud/cloudApi'
import type {
  CloudApiConfig,
  RemoteProjectSummary,
} from '@src/lib/fileSystem/cloud/types'
import { createCloudFileSystem } from '@src/lib/fs-zds/cloud'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { reportRejection } from '@src/lib/trap'

export type { CloudSaveState, CloudFileChange } from '@src/lib/fs-zds/cloud'

/** Project-level cloud services owned by the fileOperations plugin. */
export function createCloudStorage(
  paths: IZooDesignStudioFS,
  config: () => CloudApiConfig
) {
  let listGeneration = 0
  const projects = signal<readonly RemoteProjectSummary[]>([])
  const fileSystem = createCloudFileSystem(
    paths,
    config,
    (remote) => {
      listGeneration += 1
      projects.value = [
        ...projects.peek().filter((project) => project.id !== remote.id),
        remote,
      ]
    },
    (id) => {
      listGeneration += 1
      projects.value = projects.peek().filter((project) => project.id !== id)
    }
  )
  const runtime = createFileOperationsRuntime(fileSystem, {
    atomicFileReads: true,
  })
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
    void api
      .getRemoteProjectThumbnailUrl(config(), project)
      .then((url) => {
        const current = projects.peek().find((item) => item.id === project.id)
        if (
          disposed ||
          !thumbnailWatches.peek().has(project.id) ||
          !current ||
          thumbnailVersion(current) !== version ||
          thumbnailRequests.get(project.id) !== version
        )
          return
        if (url) {
          thumbnailVersions.set(project.id, version)
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
  return {
    fileSystem,
    root: fileSystem.root,
    pathFor: fileSystem.pathFor,
    idFor: fileSystem.idFor,
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
    saves: fileSystem.saves,
    subscribe: fileSystem.subscribe,
    openProject: fileSystem.openProject,
    refreshProject: fileSystem.refreshProject,
    createProject: fileSystem.createProject,
    deleteProject: fileSystem.deleteProject,
    renameProject: fileSystem.renameProject,
    duplicateProject: fileSystem.duplicateProject,
    retry: fileSystem.retry,
    snapshot: fileSystem.snapshot,
    batch: <T>(
      path: string,
      run: (operations: FileOperationsRegistryService) => Promise<T>
    ) => fileSystem.batch(path, (memory) => withFileOperations(memory, run)),
    listProjects: async () => {
      const generation = ++listGeneration
      const requestConfig = config()
      const result = await api.listRemoteProjects(requestConfig)
      if (
        generation === listGeneration &&
        requestConfig.accountId === config().accountId
      )
        projects.value = result
      return result
    },
    exists: async (id: string) => {
      try {
        await api.getRemoteProject(config(), id)
        return true
      } catch (error) {
        if (error instanceof api.CloudApiError && error.status === 404)
          return false
        return Promise.reject(error)
      }
    },
    getProjectStatus: async (id: string) =>
      (
        await import('@src/lib/fileSystem/cloud/publication')
      ).getCloudPublicationStatus(id, config().token),
    getProjectStatuses: async () =>
      (
        await import('@src/lib/fileSystem/cloud/publication')
      ).getCloudPublicationStatuses(config().token),
    downloadProjectById: async (id: string) =>
      (
        await import('@src/lib/fileSystem/cloud/publicProject')
      ).downloadProjectById(id),
    getPublicProjectNameById: async (id: string) =>
      (
        await import('@src/lib/fileSystem/cloud/publicProject')
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
            '@src/lib/fileSystem/cloud/publication'
          )
          const result = await publication.publishCurrentProject({
            ...args,
            fileOperations,
            remoteProjectId: id,
            expectedRevision: String(snapshot.remote.revision),
            deletedPaths: snapshot.deletedPaths,
          })
          if (result)
            snapshot.acknowledge(await api.getRemoteProject(config(), id))
          return result
        })
      )
    },
    getCurrentProjectPublicationDetails: async (
      args: Parameters<
        typeof Publication.getCurrentProjectPublicationDetails
      >[0]
    ) => {
      const publication = await import('@src/lib/fileSystem/cloud/publication')
      return publication.getCurrentProjectPublicationDetails(args)
    },
    thumbnail: (project: RemoteProjectSummary) =>
      api.getRemoteProjectThumbnailUrl(config(), project),
    dispose: async () => {
      disposed = true
      stopThumbnailWatcher()
      await fileSystem.detach()
      await runtime.dispose()
    },
  }
}

export type CloudStorageService = ReturnType<typeof createCloudStorage>
