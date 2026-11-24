import {
  getProjectArchiveLimitError,
  type ProjectArchiveLimitError,
} from '@src/lib/cloudProjects/runtime/archiveContents'
import { computed, effect, signal } from '@preact/signals-core'
import type * as Publication from '@src/lib/publishing/publication'
import type { PublishCurrentProjectArgs } from '@src/lib/publishing/publication'
import type {
  CloudApiConfig,
  RemoteProjectSummary,
} from '@src/lib/cloudProjects/runtime/types'
import { createCloudProjectRuntime } from '@src/lib/cloudProjects/runtime'
import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler'
import type { FileOperationsMount } from '@src/lib/fileSystem/mounts'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { reportRejection } from '@src/lib/trap'

const loadPublication = () => import('@src/lib/publishing/publication')

/** Owns cloud persistence, revision acknowledgments, and the mounted file adapter. */
export function createCloudProjectsServices(
  paths: IZooDesignStudioFS,
  config: () => CloudApiConfig
) {
  const fileSystem = createCloudProjectRuntime(paths, config)
  const { projects } = fileSystem
  const scheduler = createFileOperationsScheduler(fileSystem, {
    // Cloud paths remain case-sensitive on every desktop platform.
    pathLockKey: (path) => path,
    atomicFileReads: true,
    captureMutationGuard: fileSystem.captureMutationGuard,
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
  let stopThumbnailWatcher = () => {}
  queueMicrotask(() => {
    if (disposed) return
    stopThumbnailWatcher = effect(() => {
      const watched = thumbnailWatches.value
      const visible = new Set(projects.value.map((project) => project.id))
      for (const id of thumbnails.peek().keys())
        if (!visible.has(id)) {
          const next = new Map(thumbnails.peek())
          next.delete(id)
          thumbnails.value = next
          thumbnailVersions.delete(id)
        }
      for (const project of projects.value)
        if (watched.has(project.id)) loadThumbnail(project)
    })
  })
  const withFileOperations = async <T>(
    backing: IZooDesignStudioFS,
    run: (operations: FileOperationsRegistryService) => Promise<T>
  ) => {
    const scoped = createFileOperationsScheduler(backing)
    try {
      return await run(scoped.operations)
    } finally {
      await scoped.dispose()
    }
  }
  const archiveFailure = signal<
    | {
        owner: string | undefined
        error: ProjectArchiveLimitError
      }
    | undefined
  >(undefined)
  let archiveAttempt = 0
  const archiveOperation = async <T>(run: () => Promise<T>): Promise<T> => {
    const attempt = ++archiveAttempt
    const owner = config().accountId
    archiveFailure.value = undefined
    const recordFailure = (error: unknown) => {
      const limitError = getProjectArchiveLimitError(error)
      if (
        !disposed &&
        attempt === archiveAttempt &&
        owner === config().accountId &&
        limitError
      )
        archiveFailure.value = { owner, error: limitError }
    }
    try {
      const result = await run()
      recordFailure(result)
      return result
    } catch (error) {
      recordFailure(error)
      return Promise.reject(error)
    }
  }
  const cloud = {
    ...fileSystem,
    archiveLimitFailure: computed(() =>
      archiveFailure.value?.owner === config().accountId
        ? archiveFailure.value?.error
        : undefined
    ),
    dismissArchiveLimitFailure: () => {
      archiveAttempt += 1
      archiveFailure.value = undefined
    },
    openProject: (...args: Parameters<typeof fileSystem.openProject>) =>
      archiveOperation(() => fileSystem.openProject(...args)),
    createProject: (...args: Parameters<typeof fileSystem.createProject>) =>
      archiveOperation(() => fileSystem.createProject(...args)),
    duplicateProject: (
      ...args: Parameters<typeof fileSystem.duplicateProject>
    ) => archiveOperation(() => fileSystem.duplicateProject(...args)),
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
      (await loadPublication()).getCloudPublicationStatus(id, config().token),
    getProjectStatuses: async () =>
      (await loadPublication()).getCloudPublicationStatuses(config().token),
    downloadProjectById: (id: string) =>
      archiveOperation(async () =>
        (
          await import('@src/lib/cloudProjects/runtime/project')
        ).downloadProjectById(id)
      ),
    getProjectNameById: async (id: string) =>
      (
        await import('@src/lib/cloudProjects/runtime/project')
      ).getProjectNameById(id),
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
          const publication = await loadPublication()
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
      const publication = await loadPublication()
      return publication.getCurrentProjectPublicationDetails(args)
    },
  }
  const mount: FileOperationsMount = {
    root: fileSystem.root,
    batch: cloud.batch,
    operations: {
      ...scheduler.operations,
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
        (await scheduler.operations.pending()) + fileSystem.pending(),
    },
  }
  return {
    cloud,
    mount,
    dispose: async () => {
      disposed = true
      stopThumbnailWatcher()
      await fileSystem.detach()
      await scheduler.dispose()
    },
  }
}

export type CloudStorageService = ReturnType<
  typeof createCloudProjectsServices
>['cloud']
