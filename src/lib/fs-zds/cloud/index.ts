import { PROJECT_IMAGE_NAME } from '@src/lib/constants'
import { signal } from '@preact/signals-core'
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
} from '@src/lib/fs-zds/cloud/types'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import { prepareProjectTomlForDuplication } from '@src/lib/projectTomlMetadata'
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

/** A cloud filesystem backed by memory, with serialized revision-checked saves. */
export function createCloudFileSystem(
  paths: IZooDesignStudioFS,
  config: () => CloudApiConfig,
  onProjectUpdated: (project: RemoteProject) => void = () => {},
  onProjectDeleted: (id: string) => void = () => {}
) {
  const root = paths.resolve('/__zoo_cloud__')
  const memory = createMemoryFileSystem(paths)
  let pendingRequests = 0
  const saves = signal<ReadonlyMap<string, CloudSaveState>>(new Map())
  const opened = new Map<string, OpenCloudProject>()
  const pendingThumbnails = new Map<
    string,
    { bytes: Uint8Array<ArrayBuffer>; timer?: ReturnType<typeof setTimeout> }
  >()
  const clearThumbnail = (id: string) => {
    clearTimeout(pendingThumbnails.get(id)?.timer)
    pendingThumbnails.delete(id)
  }
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
    for (const name of await memory.readdir(directory)) {
      const path = paths.join(directory, name)
      if (((await memory.stat(path)).mode & 0o170000) === 0o040000)
        result.push(...(await collect(path, base)))
      else
        result.push({
          relativePath: paths.relative(base, path).replaceAll('\\', '/'),
          data: await memory.readFile(path),
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
    memory.replaceDirectory(projectRoot, entries)
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
    })
    onProjectUpdated(remote)
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
    let archive = snapshot ?? (await collect(pathFor(id)))
    const thumbnail = pendingThumbnails.get(id)
    if (thumbnail)
      archive = [
        ...archive.filter((file) => file.relativePath !== PROJECT_IMAGE_NAME),
        { relativePath: PROJECT_IMAGE_NAME, data: thumbnail.bytes },
      ]
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
    persist = true,
    reportSaveFailure = true
  ): Promise<T> => {
    const project = opened.get(id)
    if (!project) return Promise.reject(new Error('Cloud project is not open.'))
    const requestConfig = config()
    if (project.owner !== requestConfig.accountId)
      return Promise.reject(
        new Error('Reload to open cloud projects after changing accounts.')
      )
    pendingRequests += 1
    const result = project.queue
      .catch(() => undefined)
      .then(async () => {
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
          const value = await work(previousState)
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
          if (!persist && saves.peek().get(id)?.state === 'saving')
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
      false
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
  const mutate = <T>(path: string, work: () => Promise<T>) =>
    enqueue(idFor(path), work)
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
  const sameProject = (source: string, destination: string) =>
    idFor(source) === idFor(destination)
  const fs: IZooDesignStudioFS = {
    ...memory,
    access: (path, flags) => read(path, () => memory.access(path, flags)),
    stat: (path, options) => read(path, () => memory.stat(path, options)),
    readFile: ((path: string, options?: unknown) =>
      read<string | Uint8Array>(path, () =>
        options ? memory.readFile(path, 'utf8') : memory.readFile(path)
      )) as IZooDesignStudioFS['readFile'],
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
    const requestConfig = config()
    const project = opened.get(id)
    if (project && project.owner !== requestConfig.accountId)
      return Promise.reject(
        new Error('Cloud project belongs to a different account.')
      )
    // A delayed preview must not race the project's deletion request.
    clearTimeout(pendingThumbnails.get(id)?.timer)
    await project?.queue.catch(() => undefined)
    if (config().accountId !== requestConfig.accountId)
      return Promise.reject(new Error('Cloud account changed before deletion.'))
    await api.deleteRemoteProject(requestConfig, id)
    if (config().accountId !== requestConfig.accountId)
      return Promise.reject(new Error('Cloud account changed during deletion.'))
    // Releasing an in-memory mount cannot remove any historical disk mirror.
    if (opened.has(id))
      await memory.rm(pathFor(id), { recursive: true, force: true })
    clearThumbnail(id)
    opened.delete(id)
    const remainingSaves = new Map(saves.peek())
    remainingSaves.delete(id)
    saves.value = remainingSaves
    onProjectDeleted(id)
    notify([{ path: pathFor(id), eventType: 'unlinkDir' }])
  }
  return {
    ...fs,
    root,
    pathFor,
    idFor,
    saves,
    stageThumbnail: async (path: string, bytes: Uint8Array) => {
      const id = idFor(path)
      const project = opened.get(id)
      if (!project || project.owner !== config().accountId)
        return Promise.reject(
          new Error('Cloud project is not open for this account.')
        )
      clearThumbnail(id)
      pendingThumbnails.set(id, { bytes: new Uint8Array(bytes) })
      deferThumbnail(id)
    },
    editorChanged: (path: string) => deferThumbnail(idFor(path)),
    pending: () => pendingRequests,
    subscribe: (listener: (changes: readonly CloudFileChange[]) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    openProject,
    refreshProject: async (
      id: string,
      isCurrent: () => boolean = () => true
    ) => {
      await openProject(id)
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
          const requestConfig = config()
          // Metadata and archive use separate requests. Recheck the revision so a
          // concurrent cloud mutation cannot mix one snapshot with another revision.
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const remote = await api.getRemoteProject(requestConfig, id)
            const archive = await parseProjectArchive(
              await api.downloadRemoteProjectArchive(requestConfig, id)
            )
            const latest = await api.getRemoteProject(requestConfig, id)
            if (config().accountId !== requestConfig.accountId)
              return Promise.reject(
                new Error('Cloud account changed during refresh.')
              )
            if (!isCurrent()) return
            if (String(remote.revision) !== String(latest.revision)) continue
            clearThumbnail(id)
            await hydrate(id, archive)
            acknowledge(id, latest, archive)
            return
          }
          return Promise.reject(
            new Error('Cloud project kept changing during refresh. Try again.')
          )
        },
        false,
        false
      )
    },
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
      const requestConfig = config()
      const remote = await api.createRemoteProject(
        requestConfig,
        title,
        filesWithTitle
      )
      if (config().accountId !== requestConfig.accountId)
        return Promise.reject(
          new Error('Cloud account changed during creation.')
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
      const requestConfig = config()
      const remote = await api.createRemoteProject(
        requestConfig,
        title,
        archive
      )
      if (config().accountId !== requestConfig.accountId)
        return Promise.reject(
          new Error('Cloud account changed during duplication.')
        )
      await hydrate(remote.id, archive)
      acknowledge(remote.id, remote, archive)
      return { id: remote.id, path: pathFor(remote.id) }
    },
    batch: <T>(
      path: string,
      run: (backing: IZooDesignStudioFS) => Promise<T>
    ) => enqueue(idFor(path), () => run(memory)),
    retry: (id: string) => enqueue(id, async () => {}),
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
        acknowledge: (remote: RemoteProject) => void
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
            acknowledge: (remote) => {
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
        false
      )
    },
  }
}

export type CloudFileSystem = ReturnType<typeof createCloudFileSystem>
