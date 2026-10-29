import type * as Publication from '@src/lib/fileSystem/cloud/publication'
import { prepareProjectTomlForDuplication } from '@src/lib/projectTomlMetadata'

import { v4 } from 'uuid'

import type { PublishCurrentProjectArgs } from '@src/lib/fileSystem/cloud/publication'

import { signal } from '@preact/signals-core'

import * as api from '@src/lib/fileSystem/cloud/cloudApi'

import {
  parseProjectArchive,
  withProjectTitleInArchiveFiles,
  withUpdatedProjectTomlInArchiveFiles,
} from '@src/lib/fileSystem/cloud/projectArchive'

import type {
  CloudApiConfig,
  ProjectArchiveFile,
  RemoteProject,
  RemoteProjectSummary,
} from '@src/lib/fileSystem/cloud/types'

import { createMemoryFileSystem } from '@src/lib/fileSystem/memoryFileSystem'

import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'

import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

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
}

/** Cloud persistence owns memory and HTTP; it never materializes a project on disk. */
export function createCloudStorage(
  paths: IZooDesignStudioFS,
  config: () => CloudApiConfig
) {
  const root = paths.resolve('/__zoo_cloud__')
  const memory = createMemoryFileSystem(paths)
  const runtime = createFileOperationsRuntime(memory)
  const files = runtime.operations
  let listGeneration = 0
  const projects = signal<readonly RemoteProjectSummary[]>([])
  const saves = signal<ReadonlyMap<string, CloudSaveState>>(new Map())
  const opened = new Map<string, OpenCloudProject>()
  const opening = new Map<string, Promise<string>>()
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
    listGeneration += 1
    const project = opened.get(id)
    opened.set(id, {
      remote,
      owner: config().accountId,
      acknowledgedPaths: new Set(archive.map((f) => f.relativePath)),
      queue: project?.queue ?? Promise.resolve(),
    })
    projects.value = [...projects.peek().filter((p) => p.id !== id), remote]
    state(id, { state: 'saved' })
  }
  const commit = async (
    id: string,
    snapshot?: ProjectArchiveFile[],
    requestConfig = config()
  ) => {
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
    const archive = snapshot ?? (await collect(pathFor(id)))
    const currentPaths = new Set(archive.map((f) => f.relativePath))
    const remote = await api.updateRemoteProject({
      config: requestConfig,
      projectPath: pathFor(id),
      project: project.remote,
      files: archive,
      expectedRevision: String(revision),
      deletedPaths: [...project.acknowledgedPaths].filter(
        (path) => !currentPaths.has(path)
      ),
    })
    if (config().accountId !== requestConfig.accountId)
      return Promise.reject(new Error('Cloud account changed during save.'))
    acknowledge(id, remote, archive)
  }
  const enqueue = <T>(
    id: string,
    work: () => Promise<T>,
    persist = true
  ): Promise<T> => {
    const project = opened.get(id)
    if (!project) return Promise.reject(new Error('Cloud project is not open.'))
    const requestConfig = config()
    if (project.owner !== requestConfig.accountId)
      return Promise.reject(
        new Error('Reload to open cloud projects after changing accounts.')
      )
    const result = project.queue
      .catch(() => undefined)
      .then(async () => {
        state(id, { state: 'saving' })
        try {
          if (config().accountId !== requestConfig.accountId)
            return Promise.reject(
              new Error('Cloud account changed before save.')
            )
          const before = new Map(
            (await collect(pathFor(id))).map((file) => [
              file.relativePath,
              file.data,
            ])
          )
          const value = await work()
          const after = await collect(pathFor(id))
          if (persist) await commit(id, after, requestConfig)
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
          notify(changes)
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
  const read = async <T>(path: string, run: () => Promise<T>): Promise<T> => {
    if (path !== root) {
      const project = opened.get(idFor(path))
      if (project && project.owner !== config().accountId)
        return Promise.reject(
          new Error('Cloud project belongs to a different account.')
        )
    }
    return run()
  }
  const operations: FileOperationsRegistryService = {
    ...files,
    stat: (path) => read(path, () => files.stat(path)),
    exists: (path) => read(path, () => files.exists(path)),
    readDirectory: (path) =>
      read(path, async () =>
        path === root
          ? [...opened]
              .filter(([, project]) => project.owner === config().accountId)
              .map(([id]) => id)
          : files.readDirectory(path)
      ),
    readFile: (path) => read(path, () => files.readFile(path)),
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
    const existing = opened.get(id)
    if (existing)
      return existing.owner === config().accountId
        ? Promise.resolve(pathFor(id))
        : Promise.reject(
            new Error('Reload to open cloud projects after changing accounts.')
          )
    const pending = opening.get(id)
    if (pending) return pending
    const requestConfig = config()
    const result = (async () => {
      await ready
      const remote = await api.getRemoteProject(requestConfig, id)
      const archive = await parseProjectArchive(
        await api.downloadRemoteProjectArchive(requestConfig, id)
      )
      if (config().accountId !== requestConfig.accountId)
        return Promise.reject(
          new Error('Cloud account changed while opening project.')
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
    listGeneration += 1
    projects.value = projects.peek().filter((p) => p.id !== id)
    notify([{ path: pathFor(id), eventType: 'unlinkDir' }])
  }
  return {
    root,
    pathFor,
    idFor,
    operations,
    projects,
    saves,
    subscribe: (listener: (changes: readonly CloudFileChange[]) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
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
    openProject,
    deleteProject,
    createProject: async (
      title: string,
      archive: readonly ProjectArchiveFile[]
    ) => {
      await ready
      const filesWithTitle = withUpdatedProjectTomlInArchiveFiles(
        [...archive],
        (contents) => prepareProjectTomlForDuplication(contents, title, v4())
      )
      if (filesWithTitle instanceof Error) return Promise.reject(filesWithTitle)
      const remote = await api.createRemoteProject(
        config(),
        title,
        filesWithTitle
      )
      await hydrate(remote.id, filesWithTitle)
      acknowledge(remote.id, remote, filesWithTitle)
      notify([{ path: pathFor(remote.id), eventType: 'addDir' }])
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
      const archive = withUpdatedProjectTomlInArchiveFiles(
        await collect(pathFor(id)),
        (contents) => prepareProjectTomlForDuplication(contents, title, v4())
      )
      if (archive instanceof Error) return Promise.reject(archive)
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
        (args.project?.path ? idFor(args.project.path) : undefined)
      if (!id)
        return Promise.reject(
          new Error('A cloud project must be open before publishing.')
        )
      await openProject(id)
      return enqueue(
        id,
        async () => {
          const publication = await import(
            '@src/lib/fileSystem/cloud/publication'
          )
          const result = await publication.publishCurrentProject({
            ...args,
            remoteProjectId: id,
          })
          if (result) {
            const remote = await api.getRemoteProject(config(), id)
            acknowledge(id, remote, await collect(pathFor(id)))
          }
          return result
        },
        false
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
    dispose: () => runtime.dispose(),
  }
}

export type CloudStorageService = ReturnType<typeof createCloudStorage>
