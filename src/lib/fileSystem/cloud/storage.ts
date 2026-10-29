import { signal } from '@preact/signals-core'
import * as api from '@src/lib/fileSystem/cloud/cloudApi'
import {
  parseProjectArchive,
  withProjectTitleInArchiveFiles,
} from '@src/lib/fileSystem/cloud/projectArchive'
import type {
  CloudSyncConfig,
  ProjectArchiveFile,
  RemoteProject,
  RemoteProjectSummary,
} from '@src/lib/fileSystem/cloud/types'
import { createMemoryFileSystem } from '@src/lib/fileSystem/memoryFileSystem'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

export interface CloudSaveState {
  readonly state: 'saved' | 'saving' | 'failed'
  readonly error?: unknown
}
interface OpenCloudProject {
  remote: RemoteProject
  acknowledgedPaths: Set<string>
  queue: Promise<unknown>
}

/** Cloud persistence owns memory and HTTP; it never materializes a project on disk. */
export function createCloudStorage(
  paths: IZooDesignStudioFS,
  config: () => CloudSyncConfig
) {
  const root = paths.resolve('/__zoo_cloud__')
  const memory = createMemoryFileSystem(paths)
  const runtime = createFileOperationsRuntime(memory)
  const files = runtime.operations
  const projects = signal<readonly RemoteProjectSummary[]>([])
  const saves = signal<ReadonlyMap<string, CloudSaveState>>(new Map())
  const opened = new Map<string, OpenCloudProject>()
  const opening = new Map<string, Promise<string>>()
  const listeners = new Set<(paths: readonly string[]) => void>()
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
  const notify = (changed: readonly string[]) => {
    for (const listener of listeners) listener(changed)
  }
  const collect = async (
    directory: string,
    base = directory
  ): Promise<ProjectArchiveFile[]> => {
    const result: ProjectArchiveFile[] = []
    for (const name of await files.readDirectory(directory)) {
      const path = paths.join(directory, name)
      if ((await files.stat(path)).kind === 'directory')
        result.push(...(await collect(path, base)))
      else
        result.push({
          relativePath: paths.relative(base, path).replaceAll('\\', '/'),
          data: await files.readFile(path),
        })
    }
    return result
  }
  const hydrate = async (
    id: string,
    archive: readonly ProjectArchiveFile[]
  ) => {
    const projectRoot = pathFor(id)
    // Validate the complete archive before inserting any bytes.
    const entries = archive.map((file) => {
      const path = paths.resolve(projectRoot, file.relativePath)
      const relative = paths.relative(projectRoot, path)
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${paths.sep}`)
      ) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new Error('Cloud archive contains a path outside its project.')
      }
      return { path, data: file.data }
    })
    await memory.mkdir(projectRoot, { recursive: true })
    for (const entry of entries) {
      await memory.mkdir(paths.dirname(entry.path), { recursive: true })
      await memory.writeFile(entry.path, new Uint8Array(entry.data))
    }
  }
  const acknowledge = (
    id: string,
    remote: RemoteProject,
    archive: readonly ProjectArchiveFile[]
  ) => {
    const project = opened.get(id)
    opened.set(id, {
      remote,
      acknowledgedPaths: new Set(archive.map((f) => f.relativePath)),
      queue: project?.queue ?? Promise.resolve(),
    })
    projects.value = [...projects.peek().filter((p) => p.id !== id), remote]
    state(id, { state: 'saved' })
  }
  const commit = async (id: string) => {
    const project = opened.get(id)
    if (!project) return Promise.reject(new Error('Cloud project is not open.'))
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
    const archive = await collect(pathFor(id))
    const currentPaths = new Set(archive.map((f) => f.relativePath))
    const remote = await api.updateRemoteProject({
      config: config(),
      projectPath: pathFor(id),
      project: project.remote,
      files: archive,
      expectedRevision: String(revision),
      deletedPaths: [...project.acknowledgedPaths].filter(
        (path) => !currentPaths.has(path)
      ),
    })
    acknowledge(id, remote, archive)
  }
  const enqueue = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const project = opened.get(id)
    if (!project) return Promise.reject(new Error('Cloud project is not open.'))
    const result = project.queue
      .catch(() => undefined)
      .then(async () => {
        state(id, { state: 'saving' })
        try {
          const value = await work()
          await commit(id)
          notify([pathFor(id)])
          return value
        } catch (error) {
          state(id, { state: 'failed', error })
          return Promise.reject(error)
        }
      })
    project.queue = result
    return result
  }
  const mutate = <T>(path: string, work: () => Promise<T>) =>
    enqueue(idFor(path), work)
  const operations: FileOperationsRegistryService = {
    ...files,
    writeFile: (path, contents) => {
      const owned =
        typeof contents === 'string' ? contents : new Uint8Array(contents)
      return mutate(path, () => files.writeFile(path, owned))
    },
    createFile: (path, contents) => {
      const owned =
        typeof contents === 'string' ? contents : new Uint8Array(contents)
      return mutate(path, () => files.createFile(path, owned))
    },
    createUniqueFile: (parent, name, contents) => {
      const owned =
        typeof contents === 'string' ? contents : new Uint8Array(contents)
      return mutate(parent, () => files.createUniqueFile(parent, name, owned))
    },
    createDirectory: (path) => mutate(path, () => files.createDirectory(path)),
    createUniqueDirectory: (parent, name) =>
      mutate(parent, () => files.createUniqueDirectory(parent, name)),
    remove: (path) =>
      path === pathFor(idFor(path))
        ? deleteProject(idFor(path))
        : mutate(path, () => files.remove(path)),
    copy: (source, destination, options) =>
      mutate(destination, () => files.copy(source, destination, options)),
    rename: (source, destination) => {
      if (idFor(source) !== idFor(destination))
        return Promise.reject(new Error('Rename cannot cross cloud projects.'))
      return mutate(source, () => files.rename(source, destination))
    },
    move: (source, destination) => {
      if (idFor(source) !== idFor(destination))
        return Promise.reject(new Error('Move cannot cross cloud projects.'))
      return mutate(source, () => files.move(source, destination))
    },
  }
  const openProject = (id: string): Promise<string> => {
    if (opened.has(id)) return Promise.resolve(pathFor(id))
    const pending = opening.get(id)
    if (pending) return pending
    const result = (async () => {
      await ready
      const remote = await api.getRemoteProject(config(), id)
      const archive = await parseProjectArchive(
        await api.downloadRemoteProjectArchive(config(), id)
      )
      await hydrate(id, archive)
      acknowledge(id, remote, archive)
      return pathFor(id)
    })().finally(() => opening.delete(id))
    opening.set(id, result)
    return result
  }
  const deleteProject = async (id: string) => {
    await opened.get(id)?.queue.catch(() => undefined)
    await api.deleteRemoteProject(config(), id)
    // Releasing an in-memory mount cannot remove any historical disk mirror.
    if (await files.exists(pathFor(id))) await files.remove(pathFor(id))
    opened.delete(id)
    projects.value = projects.peek().filter((p) => p.id !== id)
    notify([pathFor(id)])
  }
  return {
    root,
    pathFor,
    idFor,
    operations,
    projects,
    saves,
    subscribe: (listener: (paths: readonly string[]) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    listProjects: async () => {
      const result = await api.listRemoteProjects(config())
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
    openProject,
    deleteProject,
    createProject: async (
      title: string,
      archive: readonly ProjectArchiveFile[]
    ) => {
      await ready
      const filesWithTitle = withProjectTitleInArchiveFiles([...archive], title)
      const remote = await api.createRemoteProject(
        config(),
        title,
        filesWithTitle
      )
      await hydrate(remote.id, filesWithTitle)
      acknowledge(remote.id, remote, filesWithTitle)
      notify([pathFor(remote.id)])
      return { id: remote.id, path: pathFor(remote.id) }
    },
    renameProject: async (id: string, title: string) => {
      await openProject(id)
      await enqueue(id, async () => {
        const archive = withProjectTitleInArchiveFiles(
          await collect(pathFor(id)),
          title
        )
        await hydrate(id, archive)
      })
    },
    duplicateProject: async (id: string, title: string) => {
      await openProject(id)
      await opened.get(id)?.queue.catch(() => undefined)
      const archive = withProjectTitleInArchiveFiles(
        await collect(pathFor(id)),
        title
      )
      const remote = await api.createRemoteProject(config(), title, archive)
      await hydrate(remote.id, archive)
      acknowledge(remote.id, remote, archive)
      return { id: remote.id, path: pathFor(remote.id) }
    },
    batch: <T>(
      path: string,
      run: (operations: FileOperationsRegistryService) => Promise<T>
    ) => enqueue(idFor(path), () => run(files)),
    retry: (id: string) => enqueue(id, async () => {}),
    snapshot: async (id: string) => {
      await openProject(id)
      return collect(pathFor(id))
    },
    thumbnail: (project: RemoteProjectSummary) =>
      api.getRemoteProjectThumbnailUrl(config(), project),
    dispose: () => runtime.dispose(),
  }
}

export type CloudStorageService = ReturnType<typeof createCloudStorage>
