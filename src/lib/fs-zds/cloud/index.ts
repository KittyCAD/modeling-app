import {
  collectCloudSnapshot,
  replaceCloudSnapshot,
  sameSnapshot,
} from '@src/lib/fs-zds/cloud/snapshot'
import {
  downloadDeletedCloudEntries,
  isDeletedCloudPath,
  type CloudFileDeletion,
} from '@src/lib/fs-zds/cloud/deletion'
import {
  CLOUD_DIRECTORIES_FILE,
  decodeCloudDirectories,
} from '@src/lib/fs-zds/cloud/directories'
import { subscribeToSet } from '@src/lib/utils'
import { incrementMapCounter } from '@src/lib/utils'
import { planCloudRefresh } from '@src/lib/fs-zds/cloud/refresh'
import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
import { PROJECT_IMAGE_NAME } from '@src/lib/constants'
import { computed, signal } from '@preact/signals-core'
import { v4 } from 'uuid'
import * as api from '@src/lib/fs-zds/cloud/api'
import {
  parseProjectArchive,
  withProjectTitleInArchiveFiles,
  withUpdatedProjectTomlInArchiveFiles,
} from '@src/lib/fs-zds/cloud/archive'
import type {
  CloudApiConfig,
  ProjectArchiveFile,
  RemoteProject,
  RemoteProjectSummary,
} from '@src/lib/fs-zds/cloud/types'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import { prepareProjectTomlForDuplication } from '@src/lib/projectTomlMetadata'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { isOffline } from '@src/lib/networkStatus'

const offlineError = () =>
  new Error('Cloud projects are read-only while offline. Reconnect to edit.')

export interface CloudFileChange {
  readonly path: string
  readonly eventType: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
}

export interface CloudSaveState {
  readonly state: 'saved' | 'saving' | 'failed'
  readonly error?: unknown
}
interface OpenCloudProject {
  remote: RemoteProject
  owner: string | undefined
  acknowledgedPaths: Set<string>
  queue: Promise<unknown>
  generation: number
  needsReconciliation: boolean
  observedRevision: RemoteProject['revision']
}

export interface CloudProjectUpdate {
  readonly changed: boolean
  readonly refreshed: boolean
}

const downloadArchive = async (
  ...args: Parameters<typeof api.downloadRemoteProjectArchive>
) => parseProjectArchive(await api.downloadRemoteProjectArchive(...args))

/** A cloud filesystem backed by memory, with serialized revision-checked saves. */
export function createCloudFileSystem(
  paths: IZooDesignStudioFS,
  config: () => CloudApiConfig
) {
  const root = paths.resolve('/__zoo_cloud__')
  const memory = createMemoryFileSystem(paths)
  let pendingRequests = 0
  const saves = signal<ReadonlyMap<string, CloudSaveState>>(new Map())
  const projects = signal<readonly RemoteProjectSummary[]>([])
  let listGeneration = 0
  const pendingProjectLists = signal(0)
  const opened = new Map<string, OpenCloudProject>()
  const activityVersions = new Map<string, number>()
  const activityListeners = new Set<(id: string) => void>()
  const polling = new Map<string, Promise<CloudProjectUpdate>>()
  const activity = (id: string) => {
    incrementMapCounter(activityVersions, id)
    for (const listener of activityListeners) listener(id)
  }
  const pendingThumbnails = new Map<
    string,
    { bytes: Uint8Array<ArrayBuffer>; timer?: ReturnType<typeof setTimeout> }
  >()
  const clearThumbnail = (id: string) => {
    clearTimeout(pendingThumbnails.get(id)?.timer)
    pendingThumbnails.delete(id)
  }
  const opening = new Map<string, Promise<string>>()
  const deleting = new Map<string, Promise<void>>()
  const deletingError = () => new Error('Cloud project is being deleted.')
  const reconciliationListeners = new Set<
    (root: string, files: readonly ProjectArchiveFile[]) => void
  >()
  const listeners = new Set<(changes: readonly CloudFileChange[]) => void>()
  const ready = memory.mkdir(root, { recursive: true })
  const pathFor = (id: string) => paths.join(root, id)
  const idFor = (path: string) => {
    const relative = paths.relative(root, paths.resolve(path))
    const id = relative.match(/^[^\\/]+/)?.[0]
    if (!id || relative === '..' || relative.startsWith(`..${paths.sep}`)) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new Error('Path is outside cloud project storage.')
    }
    return id
  }
  const state = (id: string, value: CloudSaveState) => {
    saves.value = new Map(saves.peek()).set(id, value)
  }
  const notify = (changed: readonly CloudFileChange[]) => {
    for (const listener of listeners) listener(changed)
  }
  const collect = (directory: string) => collectCloudSnapshot(memory, directory)
  const downloadRefresh = async (
    requestConfig: CloudApiConfig,
    id: string,
    remote: RemoteProject,
    canDownload: () => boolean = () => true,
    signal?: AbortSignal
  ) => {
    const plan = planCloudRefresh(
      opened.get(id)!.remote,
      remote,
      await collect(pathFor(id))
    )
    if (!canDownload()) return
    const downloaded = plan.selected.length
      ? await downloadArchive(
          requestConfig,
          id,
          String(remote.revision ?? ''),
          plan.selected.map((file) => file.id),
          signal
        )
      : []
    return plan.merge(downloaded)
  }
  const hydrate = (id: string, archive: readonly ProjectArchiveFile[]) => {
    replaceCloudSnapshot(memory, pathFor(id), archive)
  }
  const acknowledge = (
    id: string,
    remote: RemoteProject,
    archive: readonly ProjectArchiveFile[]
  ) => {
    const project = opened.get(id)
    opened.set(id, {
      remote,
      owner: config().accountId,
      acknowledgedPaths: new Set(archive.map((f) => f.relativePath)),
      queue: project?.queue ?? Promise.resolve(),
      generation: project?.generation ?? 0,
      needsReconciliation: false,
      observedRevision: remote.revision,
    })
    listGeneration += 1
    projects.value = [
      ...projects.peek().filter((item) => item.id !== id),
      remote,
    ]
    state(id, { state: 'saved' })
    if (project?.remote.revision !== remote.revision) activity(id)
  }
  const reconcile = async (
    id: string,
    requestConfig: CloudApiConfig,
    submitted?: readonly ProjectArchiveFile[]
  ) => {
    const project = opened.get(id)!
    const alreadyInvalidated = project.needsReconciliation
    // A rejected retry can be an acknowledgement of our own earlier upload.
    // Keep its waiting edits valid unless the downloaded contents actually differ.
    if (!submitted && !alreadyInvalidated) project.generation += 1
    project.needsReconciliation = true
    clearThumbnail(id)
    let remote: RemoteProject
    let archive: ProjectArchiveFile[]
    try {
      remote = await api.getRemoteProject(requestConfig, id)
      archive = await downloadArchive(
        requestConfig,
        id,
        String(remote.revision ?? '')
      )
    } catch (error) {
      if (submitted && !alreadyInvalidated) project.generation += 1
      return Promise.reject(error)
    }
    if (
      config().accountId !== requestConfig.accountId ||
      opened.get(id) !== project
    )
      return Promise.reject(
        new Error('Cloud project changed during reconciliation.')
      )
    const sameContents =
      submitted !== undefined && sameSnapshot(submitted, archive)
    if (sameContents) {
      // Keep staged thumbnail bytes in memory too, without replacing editor source.
      hydrate(id, archive)
      acknowledge(id, remote, archive)
      return
    }
    if (submitted && !alreadyInvalidated) project.generation += 1
    hydrate(id, archive)
    acknowledge(id, remote, archive)
    for (const listener of reconciliationListeners)
      listener(pathFor(id), archive)
    notify([{ path: pathFor(id), eventType: 'change' }])
  }
  const commit = async (
    id: string,
    snapshot?: ProjectArchiveFile[],
    requestConfig = { ...config() }
  ) => {
    const project = opened.get(id)
    if (!project) return Promise.reject(new Error('Cloud project is not open.'))
    if (project.needsReconciliation) return reconcile(id, requestConfig)
    const revision = project.remote.revision
    if (
      revision === undefined ||
      revision === null ||
      String(revision) === ''
    ) {
      return Promise.reject(
        new Error('Cloud project is missing its revision; save canceled.')
      )
    }
    let archive = snapshot ?? (await collect(pathFor(id)))
    const thumbnail = pendingThumbnails.get(id)
    if (thumbnail)
      archive = [
        ...archive.filter((file) => file.relativePath !== PROJECT_IMAGE_NAME),
        { relativePath: PROJECT_IMAGE_NAME, data: thumbnail.bytes },
      ]
    const currentPaths = new Set(archive.map((f) => f.relativePath))
    let remote: RemoteProject
    try {
      remote = await api.updateRemoteProject({
        config: requestConfig,
        projectPath: pathFor(id),
        project: project.remote,
        files: archive,
        expectedRevision: String(revision),
        deletedPaths: [...project.acknowledgedPaths].filter(
          (path) => !currentPaths.has(path)
        ),
      })
    } catch (error) {
      if (error instanceof api.CloudApiError && error.status === 409)
        return reconcile(id, requestConfig, archive)
      return Promise.reject(error)
    }
    if (config().accountId !== requestConfig.accountId)
      return Promise.reject(new Error('Cloud account changed during save.'))
    if (thumbnail) {
      await memory.writeFile(
        paths.join(pathFor(id), PROJECT_IMAGE_NAME),
        thumbnail.bytes
      )
      if (pendingThumbnails.get(id) === thumbnail) clearThumbnail(id)
    }
    acknowledge(id, remote, archive)
  }
  const enqueue = <T>(
    id: string,
    work: (previousState: CloudSaveState | undefined) => Promise<T>,
    {
      persist = true,
      reportSaveFailure = true,
      allowReconciliation = false,
    }: {
      persist?: boolean
      reportSaveFailure?: boolean
      allowReconciliation?: boolean
    } = {}
  ): Promise<T> => {
    if (isOffline()) return Promise.reject(offlineError())
    if (deleting.has(id)) return Promise.reject(deletingError())
    const project = opened.get(id)
    if (!project) return Promise.reject(new Error('Cloud project is not open.'))
    const requestConfig = { ...config() }
    if (project.owner !== requestConfig.accountId)
      return Promise.reject(
        new Error('Reload to open cloud projects after changing accounts.')
      )
    if (project.needsReconciliation && !allowReconciliation)
      return Promise.reject(
        new Error('Cloud snapshot needs reconciliation. Retry before editing.')
      )
    const generation = project.generation
    pendingRequests += 1
    const result = project.queue
      .catch(() => undefined)
      .then(async () => {
        if (isOffline()) return Promise.reject(offlineError())
        if (opened.get(id)?.generation !== generation)
          return Promise.reject(
            new Error('Cloud snapshot changed; queued operation canceled.')
          )
        const previousState = saves.peek().get(id)
        if (reportSaveFailure) state(id, { state: 'saving' })
        try {
          if (config().accountId !== requestConfig.accountId) {
            // eslint-disable-next-line suggest-no-throw/suggest-no-throw
            throw new Error('Cloud account changed before save.')
          }
          const before = new Map(
            (await collect(pathFor(id))).map((file) => [
              file.relativePath,
              file.data,
            ])
          )
          if (isOffline()) {
            state(id, previousState ?? { state: 'saved' })
            return Promise.reject(offlineError())
          }
          const value = await work(previousState)
          const after = await collect(pathFor(id))
          const changes: CloudFileChange[] = []
          for (const file of after) {
            const old = before.get(file.relativePath)
            if (
              !old ||
              old.length !== file.data.length ||
              !old.every((byte, index) => byte === file.data[index])
            )
              changes.push({
                path: paths.join(pathFor(id), file.relativePath),
                eventType: old ? 'change' : 'add',
              })
            before.delete(file.relativePath)
          }
          for (const relativePath of before.keys())
            changes.push({
              path: paths.join(pathFor(id), relativePath),
              eventType: 'unlink',
            })
          if (
            persist &&
            (changes.length > 0 ||
              pendingThumbnails.has(id) ||
              previousState?.state === 'failed')
          )
            await commit(id, after, requestConfig)
          if (opened.get(id)?.generation === generation) notify(changes)
          if (saves.peek().get(id)?.state === 'saving')
            state(id, previousState ?? { state: 'saved' })
          return value
        } catch (error) {
          state(
            id,
            reportSaveFailure
              ? { state: 'failed', error }
              : (previousState ?? { state: 'saved' })
          )
          return Promise.reject(error)
        }
      })
      .finally(() => {
        pendingRequests -= 1
      })
    project.queue = result
    return result
  }
  const flushThumbnail = (id: string) =>
    enqueue(
      id,
      async () => {
        // A preceding editor save may already have included the staged thumbnail.
        if (pendingThumbnails.has(id)) await commit(id)
      },
      { persist: false }
    )
  const deferThumbnail = (id: string) => {
    const thumbnail = pendingThumbnails.get(id)
    if (!thumbnail) return
    clearTimeout(thumbnail.timer)
    thumbnail.timer = setTimeout(() => {
      thumbnail.timer = undefined
      // Failure stays visible in saves and retains the bytes for explicit retry.
      void flushThumbnail(id).catch(() => undefined)
    }, 3_000)
  }
  const mutate = <T>(path: string, work: () => Promise<T>) => {
    const id = idFor(path)
    activity(id)
    return enqueue(id, work)
  }
  const read = async <T>(path: string, run: () => Promise<T>): Promise<T> => {
    path = paths.resolve(path)
    if (path !== root) {
      const project = opened.get(idFor(path))
      if (project && project.owner !== config().accountId)
        return Promise.reject(
          new Error('Cloud project belongs to a different account.')
        )
    }
    return run()
  }
  function readFile(
    path: string,
    options: { encoding: 'utf-8' }
  ): Promise<string>
  function readFile(path: string, options: 'utf8'): Promise<string>
  function readFile(path: string, options?: object): Promise<Uint8Array>
  function readFile(
    path: string,
    options?: 'utf8' | object
  ): Promise<string | Uint8Array> {
    if (options) {
      return read(path, () => memory.readFile(path, 'utf8'))
    }
    return read(path, () => memory.readFile(path))
  }
  const memoryEntryExists = async (path: string) => {
    try {
      await memory.access(path, 0)
      return true
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return false
      return Promise.reject(error)
    }
  }
  const deletionOwner = (deletion: CloudFileDeletion) => {
    const project = opened.get(deletion.projectId)
    if (
      !project ||
      project.owner !== deletion.accountId ||
      config().accountId !== deletion.accountId
    )
      return undefined
    return project
  }
  const deletePathWithRevision = (path: string): Promise<CloudFileDeletion> => {
    const id = idFor(path)
    const relative = getContainedRelativePath(
      paths,
      pathFor(id),
      paths.resolve(path)
    )
    if (!relative)
      return Promise.reject(
        new Error('Delete a cloud project through project management.')
      )
    activity(id)
    return enqueue(id, async (previous) => {
      const project = opened.get(id)!
      if (previous?.state === 'failed' || !project.remote.revision)
        return Promise.reject(
          new Error('Save the cloud project before deleting files.')
        )
      const stat = await memory.stat(path)
      const deletion: CloudFileDeletion = {
        projectId: id,
        revision: String(project.remote.revision),
        relativePath: relative.replaceAll('\\', '/'),
        directory: (stat.mode & 0o170000) === 0o040000,
        accountId: project.owner,
      }
      await memory.rm(path, { recursive: true })
      return deletion
    })
  }
  const replayDeletion = async (
    deletion: CloudFileDeletion,
    restore: boolean
  ) => {
    const project = deletionOwner(deletion)
    if (!project)
      return Promise.reject(
        new Error('Cloud deletion belongs to a different project or account.')
      )
    const requestConfig = { ...config() }
    const entries = await downloadDeletedCloudEntries(
      requestConfig,
      project.remote,
      deletion
    )
    if (!deletionOwner(deletion))
      return Promise.reject(
        new Error('Cloud account changed during file restoration.')
      )
    activity(deletion.projectId)
    const result = await enqueue(deletion.projectId, async (previous) => {
      if (!deletionOwner(deletion) || previous?.state === 'failed')
        return Promise.reject(
          new Error('Save the cloud project before replaying file deletion.')
        )
      const projectRoot = pathFor(deletion.projectId)
      const target = paths.resolve(projectRoot, deletion.relativePath)
      if (!getContainedRelativePath(paths, projectRoot, target))
        return new Error('Deleted path is outside its cloud project.')
      const snapshot = await collect(projectRoot)
      const current = snapshot.filter((file) =>
        isDeletedCloudPath(deletion, file.relativePath)
      )
      const directoryFile = snapshot.find(
        (file) => file.relativePath === CLOUD_DIRECTORIES_FILE
      )
      const directories = directoryFile
        ? decodeCloudDirectories(directoryFile.data).filter((path) =>
            isDeletedCloudPath(deletion, path)
          )
        : []
      const sameDirectories =
        directories.length === entries.directories.length &&
        directories.every((path) => entries.directories.includes(path))
      const sameFiles =
        current.length === entries.files.length &&
        current.every((file) => {
          const old = entries.files.find(
            (entry) => entry.relativePath === file.relativePath
          )
          return (
            old &&
            file.data.length === old.data.length &&
            file.data.every((byte, index) => byte === old.data[index])
          )
        })
      if (restore) {
        if (await memoryEntryExists(target)) {
          if (sameFiles && sameDirectories) return
          return new Error(
            'Cannot restore: another entry now occupies the deleted path.'
          )
        }
        if (deletion.directory) await memory.mkdir(target, { recursive: true })
        for (const directory of entries.directories)
          await memory.mkdir(paths.join(projectRoot, directory), {
            recursive: true,
          })
        for (const file of entries.files) {
          const path = paths.resolve(projectRoot, file.relativePath)
          await memory.mkdir(paths.dirname(path), { recursive: true })
          await memory.writeFile(path, file.data)
        }
      } else {
        if (!(await memoryEntryExists(target))) return
        if (!sameFiles || !sameDirectories)
          return new Error(
            'Cannot redo deletion: the restored files have changed.'
          )
        await memory.rm(target, { recursive: true })
      }
    })
    if (result instanceof Error) return Promise.reject(result)
  }
  const sameProject = (source: string, destination: string) =>
    idFor(source) === idFor(destination)
  const fs: IZooDesignStudioFS = {
    ...memory,
    access: (path, flags) => read(path, () => memory.access(path, flags)),
    stat: (path, options) => read(path, () => memory.stat(path, options)),
    readFile,
    readdir: (path, options) =>
      read(path, async () =>
        paths.resolve(path) === root
          ? [...opened]
              .filter(([, project]) => project.owner === config().accountId)
              .map(([id]) => id)
          : memory.readdir(path, options)
      ),
    writeFile: (path, contents, options) => {
      const owned = new Uint8Array(contents)
      return mutate(path, () => memory.writeFile(path, owned, options))
    },
    mkdir: (path, options) => mutate(path, () => memory.mkdir(path, options)),
    rm: (path, options) =>
      paths.resolve(path) === pathFor(idFor(path))
        ? deleteProject(idFor(path))
        : mutate(path, () => memory.rm(path, options)),
    cp: (source, destination, options) =>
      read(source, () =>
        mutate(destination, async () => {
          await memory.cp(source, destination, options)
        })
      ),
    rename: (source, destination) =>
      sameProject(source, destination)
        ? mutate(source, () => memory.rename(source, destination))
        : Promise.reject(new Error('Rename cannot cross cloud projects.')),
    attach: async () => {
      await ready
    },
    detach: async () => {
      await Promise.allSettled([...polling.values()])
      await Promise.all(
        [...pendingThumbnails.keys()].map((id) => {
          clearTimeout(pendingThumbnails.get(id)?.timer)
          return flushThumbnail(id).catch(() => undefined)
        })
      )
      await Promise.all(
        [...opening.values()].map((request) => request.catch(() => undefined))
      )
      await Promise.all(
        [...opened.values()].map((project) =>
          project.queue.catch(() => undefined)
        )
      )
      await Promise.allSettled([...deleting.values()])
    },
  }
  const openProject = (id: string): Promise<string> => {
    if (deleting.has(id)) return Promise.reject(deletingError())
    const existing = opened.get(id)
    if (existing)
      return existing.owner === config().accountId
        ? Promise.resolve(pathFor(id))
        : Promise.reject(
            new Error('Reload to open cloud projects after changing accounts.')
          )
    const pending = opening.get(id)
    if (pending) return pending
    const requestConfig = { ...config() }
    const result = (async () => {
      await ready
      const remote = await api.getRemoteProject(requestConfig, id)
      const archive = await downloadArchive(
        requestConfig,
        id,
        String(remote.revision ?? '')
      )
      if (config().accountId !== requestConfig.accountId)
        return Promise.reject(
          new Error('Cloud account changed while opening project.')
        )
      hydrate(id, archive)
      acknowledge(id, remote, archive)
      return pathFor(id)
    })().finally(() => opening.delete(id))
    opening.set(id, result)
    return result
  }
  const deleteProject = (id: string): Promise<void> => {
    const pending = deleting.get(id)
    if (pending) return pending
    const request = (async () => {
      if (isOffline()) return Promise.reject(offlineError())
      const requestConfig = { ...config() }
      const existing = opened.get(id)
      if (existing && existing.owner !== requestConfig.accountId)
        return Promise.reject(
          new Error('Cloud project belongs to a different account.')
        )
      clearTimeout(pendingThumbnails.get(id)?.timer)
      // An opening request and every accepted save finish before deletion reaches the API.
      await opening.get(id)?.catch(() => undefined)
      await opened.get(id)?.queue.catch(() => undefined)
      if (isOffline()) return Promise.reject(offlineError())
      if (config().accountId !== requestConfig.accountId)
        return Promise.reject(
          new Error('Cloud account changed before deletion.')
        )
      await api.deleteRemoteProject(requestConfig, id)
      if (config().accountId !== requestConfig.accountId)
        return Promise.reject(
          new Error('Cloud account changed during deletion.')
        )
      if (opened.has(id))
        await memory.rm(pathFor(id), { recursive: true, force: true })
      clearThumbnail(id)
      opened.delete(id)
      activityVersions.delete(id)
      const remainingSaves = new Map(saves.peek())
      remainingSaves.delete(id)
      saves.value = remainingSaves
      listGeneration += 1
      projects.value = projects.peek().filter((project) => project.id !== id)
      notify([{ path: pathFor(id), eventType: 'unlinkDir' }])
    })().finally(() => deleting.delete(id))
    deleting.set(id, request)
    return request
  }
  const createProject = async (
    title: string,
    archive: readonly ProjectArchiveFile[]
  ) => {
    if (isOffline()) return Promise.reject(offlineError())
    const requestConfig = { ...config() }
    const captured = archive.map((file) => ({
      relativePath: file.relativePath,
      data: new Uint8Array(file.data),
    }))
    await ready
    if (config().accountId !== requestConfig.accountId)
      return Promise.reject(new Error('Cloud account changed before creation.'))
    const filesWithTitle = withUpdatedProjectTomlInArchiveFiles(
      captured,
      (contents) => prepareProjectTomlForDuplication(contents, title, v4())
    )
    if (filesWithTitle instanceof Error) return Promise.reject(filesWithTitle)
    if (isOffline()) return Promise.reject(offlineError())
    const remote = await api.createRemoteProject(
      requestConfig,
      title,
      filesWithTitle
    )
    if (config().accountId !== requestConfig.accountId)
      return Promise.reject(new Error('Cloud account changed during creation.'))
    hydrate(remote.id, filesWithTitle)
    acknowledge(remote.id, remote, filesWithTitle)
    return { id: remote.id, path: pathFor(remote.id) }
  }
  return {
    ...fs,
    root,
    projects,
    projectsLoading: computed(() => pendingProjectLists.value > 0),
    listProjects: async () => {
      const generation = ++listGeneration
      const requestConfig = { ...config() }
      pendingProjectLists.value = pendingProjectLists.peek() + 1
      try {
        const result = await api.listRemoteProjects(requestConfig)
        if (
          generation === listGeneration &&
          requestConfig.accountId === config().accountId
        )
          projects.value = result
        return result
      } finally {
        pendingProjectLists.value = pendingProjectLists.peek() - 1
      }
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
    thumbnail: (project: RemoteProjectSummary) =>
      api.getRemoteProjectThumbnailUrl(config(), project),
    pathFor,
    idFor,
    captureMutationGuard: (targets: readonly string[]) => {
      const submittedOffline = isOffline()
      const generations = targets.map((path) => {
        const id = idFor(path)
        return {
          id,
          generation: opened.get(id)?.generation,
          reconciling: opened.get(id)?.needsReconciliation,
        }
      })
      return () =>
        submittedOffline || isOffline()
          ? offlineError()
          : generations.some(
                ({ id, generation, reconciling }) =>
                  reconciling || opened.get(id)?.generation !== generation
              )
            ? new Error('Cloud snapshot changed; queued operation canceled.')
            : undefined
    },
    saves,
    stageThumbnail: async (path: string, bytes: Uint8Array) => {
      if (isOffline()) return
      const id = idFor(path)
      if (deleting.has(id)) return Promise.reject(deletingError())
      const project = opened.get(id)
      if (!project || project.owner !== config().accountId)
        return Promise.reject(
          new Error('Cloud project is not open for this account.')
        )
      if (project.needsReconciliation)
        return Promise.reject(new Error('Cloud snapshot is being reconciled.'))
      clearThumbnail(id)
      pendingThumbnails.set(id, { bytes: new Uint8Array(bytes) })
      deferThumbnail(id)
    },
    editorChanged: (path: string) => {
      const id = idFor(path)
      activity(id)
      deferThumbnail(id)
    },
    subscribeActivity: (listener: (id: string) => void) =>
      subscribeToSet(activityListeners, listener),
    pending: () => pendingRequests,
    subscribeReconciled: (
      listener: (root: string, files: readonly ProjectArchiveFile[]) => void
    ) => subscribeToSet(reconciliationListeners, listener),
    subscribe: (listener: (changes: readonly CloudFileChange[]) => void) =>
      subscribeToSet(listeners, listener),
    openProject,
    checkForUpdates: (
      id: string,
      canApply: () => boolean
    ): Promise<CloudProjectUpdate> => {
      const pending = polling.get(id)
      if (pending) return pending
      const requestConfig = { ...config() }
      const project = opened.get(id)
      if (!project || project.owner !== requestConfig.accountId)
        return Promise.reject(
          new Error('Cloud project is not open for this account.')
        )
      const startingRevision = project.remote.revision
      const version = activityVersions.get(id)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60_000)
      const current = () =>
        config().accountId === requestConfig.accountId &&
        opened.has(id) &&
        !deleting.has(id)
      const unchanged: CloudProjectUpdate = { changed: false, refreshed: false }
      const request = (async (): Promise<CloudProjectUpdate> => {
        const remote = await api.getRemoteProject(
          requestConfig,
          id,
          controller.signal
        )
        if (!current()) return unchanged
        const activeProject = opened.get(id)!
        // A push refresh or local save can finish while metadata is in flight.
        if (activeProject.remote.revision !== startingRevision) return unchanged
        const changed = remote.revision !== activeProject.observedRevision
        activeProject.observedRevision = remote.revision
        if (remote.revision === activeProject.remote.revision)
          return { changed, refreshed: false }
        if (!remote.revision) return { changed, refreshed: false }
        const safe = () =>
          current() &&
          canApply() &&
          activityVersions.get(id) === version &&
          saves.peek().get(id)?.state !== 'failed' &&
          !opened.get(id)?.needsReconciliation
        if (!safe()) return { changed, refreshed: false }
        // Download without holding the mutation queue so slow networks cannot
        // block local saves. Activity invalidates the snapshot before commit.
        const archive = await downloadRefresh(
          requestConfig,
          id,
          remote,
          safe,
          controller.signal
        )
        if (!archive || !safe()) return { changed, refreshed: false }
        let refreshed = false
        await enqueue(
          id,
          async (previousState) => {
            if (previousState?.state === 'failed' || !safe()) return
            clearThumbnail(id)
            hydrate(id, archive)
            acknowledge(id, remote, archive)
            refreshed = true
          },
          { persist: false, reportSaveFailure: false }
        )
        return { changed, refreshed }
      })().finally(() => {
        clearTimeout(timeout)
        polling.delete(id)
      })
      polling.set(id, request)
      return request
    },
    refreshProject: async (
      id: string,
      isCurrent: () => boolean = () => true,
      revision?: string
    ) => {
      // A first open already downloads the current snapshot.
      if (!opened.has(id)) {
        await openProject(id)
        return
      }
      return enqueue(
        id,
        async (previousState) => {
          if (!isCurrent()) return
          if (previousState?.state === 'failed')
            return Promise.reject(
              new Error(
                'Cloud refresh skipped to preserve unsaved changes. Retry saving before refreshing.'
              )
            )
          if (
            revision !== undefined &&
            String(opened.get(id)?.remote.revision) === revision
          )
            return
          const requestConfig = { ...config() }
          const remote =
            revision === undefined
              ? await api.getRemoteProject(requestConfig, id)
              : await api.getRemoteProjectVersion(
                  requestConfig,
                  opened.get(id)!.remote,
                  revision
                )
          const archive = await downloadRefresh(requestConfig, id, remote)
          if (config().accountId !== requestConfig.accountId)
            return Promise.reject(
              new Error('Cloud account changed during refresh.')
            )
          if (!archive || !isCurrent()) return
          clearThumbnail(id)
          hydrate(id, archive)
          acknowledge(id, remote, archive)
        },
        { persist: false, reportSaveFailure: false }
      )
    },
    deleteProject,
    createProject: async (
      title: string,
      archive: readonly ProjectArchiveFile[]
    ) => {
      const result = await createProject(title, archive)
      notify([{ path: result.path, eventType: 'addDir' }])
      return result
    },
    renameProject: async (id: string, title: string) => {
      await openProject(id)
      await enqueue(id, async () => {
        const archive = withProjectTitleInArchiveFiles(
          await collect(pathFor(id)),
          title
        )
        hydrate(id, archive)
      })
    },
    duplicateProject: async (id: string, title: string) => {
      await openProject(id)
      await opened.get(id)?.queue.catch(() => undefined)
      return createProject(title, await collect(pathFor(id)))
    },
    batch: <T>(
      path: string,
      run: (backing: IZooDesignStudioFS) => Promise<T>
    ) => {
      const id = idFor(path)
      activity(id)
      return enqueue(id, () => run(memory))
    },
    retry: (id: string) =>
      enqueue(
        id,
        async (previous) => {
          if (
            previous?.state === 'failed' ||
            opened.get(id)?.needsReconciliation
          )
            await commit(id)
        },
        { persist: false, allowReconciliation: true }
      ),
    deletePathWithRevision,
    restoreDeletedPath: (deletion: CloudFileDeletion) =>
      replayDeletion(deletion, true),
    redoPathDeletion: (deletion: CloudFileDeletion) =>
      replayDeletion(deletion, false),
    snapshot: async (id: string) => {
      await openProject(id)
      return collect(pathFor(id))
    },
    withProject: async <T>(
      id: string,
      run: (snapshot: {
        remote: RemoteProject
        backing: IZooDesignStudioFS
        deletedPaths: string[]
        acknowledge: () => Promise<void>
      }) => Promise<T>
    ) => {
      await openProject(id)
      return enqueue(
        id,
        async () => {
          const project = opened.get(id)!
          const archive = await collect(pathFor(id))
          const owner = config().accountId
          const currentPaths = new Set(archive.map((file) => file.relativePath))
          return run({
            remote: project.remote,
            backing: memory,
            deletedPaths: [...project.acknowledgedPaths].filter(
              (path) => !currentPaths.has(path)
            ),
            acknowledge: async () => {
              const remote = await api.getRemoteProject(config(), id)
              if (config().accountId !== owner) {
                // eslint-disable-next-line suggest-no-throw/suggest-no-throw
                throw new Error(
                  'Cloud account changed during project operation.'
                )
              }
              acknowledge(id, remote, archive)
            },
          })
        },
        { persist: false }
      )
    },
  }
}

export type CloudFileSystem = ReturnType<typeof createCloudFileSystem>
