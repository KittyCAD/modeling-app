import { computed, type ReadonlySignal, signal } from '@preact/signals'
import type {
  CloudSyncService,
  CloudSyncStatus,
  RemoteCloudProject,
} from '@src/contracts/cloudSync'
import type { FileSystem } from '@src/contracts/fileSystem'
import { type CloudApi, CloudApiError } from '@src/features/cloudSync/cloudApi'
import {
  type CloudProjectManifest,
  manifestOf,
  manifestsEqual,
  parseCloudArchive,
  readCloudArchive,
  writeCloudArchive,
} from '@src/features/cloudSync/cloudArchive'
import {
  basename,
  joinPath,
  normalizePath,
  toDirectoryName,
  uniqueName,
} from '@src/lib/paths'
import type { ProjectLibrary } from '@src/lib/projectLibraries'

const INDEX_FILE = '.zds-cloud-sync.json'

interface SyncRecord {
  localName: string
  remoteProjectId: string
  remoteRevision?: string
  remoteUpdatedAt?: string
  baseManifest: CloudProjectManifest
  conflict?: {
    remoteRevision?: string
    detectedAt: number
  }
}

/** Durable metadata for one materialization root, written beside its projects. */
interface SyncIndex {
  schemaVersion: 1
  projects: SyncRecord[]
}

const emptyIndex = (): SyncIndex => ({ schemaVersion: 1, projects: [] })
const revisionOf = (project: RemoteCloudProject) =>
  project.revision === undefined ? undefined : String(project.revision)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Cloud sync failed.'
}

function parseIndex(value: string | null): SyncIndex {
  if (!value) return emptyIndex()
  try {
    const parsed = JSON.parse(value) as Partial<SyncIndex>
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects)) {
      return emptyIndex()
    }
    return {
      schemaVersion: 1,
      projects: parsed.projects.filter((record): record is SyncRecord =>
        Boolean(
          record &&
            typeof record.localName === 'string' &&
            typeof record.remoteProjectId === 'string' &&
            record.baseManifest &&
            typeof record.baseManifest === 'object'
        )
      ),
    }
  } catch {
    return emptyIndex()
  }
}

export interface CreateCloudSyncServiceOptions {
  fileSystem: FileSystem
  token: ReadonlySignal<string | null>
  api: CloudApi
  /** Set to zero in deterministic tests. */
  backgroundIntervalMs?: number
}

/**
 * Local-first whole-project replication without a state machine.
 *
 * A library run is a serialized async transaction over a small durable index.
 * Signals report its observable state; they do not drive control flow. Local
 * bytes are never replaced when both sides changed from the recorded base.
 */
export function createCloudSyncService({
  fileSystem,
  token,
  api,
  backgroundIntervalMs = 30_000,
}: CreateCloudSyncServiceOptions): CloudSyncService {
  const status = signal<CloudSyncStatus>({
    enabled: Boolean(token.value),
    state: token.value ? 'idle' : 'disabled',
    conflictCount: 0,
  })
  const remoteProjects = signal<readonly RemoteCloudProject[]>([])
  const registeredLibraries = new Map<string, ProjectLibrary>()
  const running = new Map<string, Promise<void>>()
  let disposed = false

  const indexPath = (library: ProjectLibrary) =>
    joinPath(library.path, INDEX_FILE)
  const readIndex = async (library: ProjectLibrary) =>
    parseIndex(await fileSystem.readTextFileIfPresent(indexPath(library)))
  const writeIndex = async (library: ProjectLibrary, index: SyncIndex) =>
    fileSystem.writeTextFile(indexPath(library), JSON.stringify(index, null, 2))

  const setIdle = (conflictCount = 0) => {
    const now = Date.now()
    status.value = {
      enabled: true,
      state: conflictCount > 0 ? 'conflict' : 'idle',
      conflictCount,
      lastSyncedAt: now,
    }
  }

  const localProjects = async (library: ProjectLibrary) => {
    await fileSystem.makeDirectory(library.path)
    const projects = new Map<
      string,
      {
        path: string
        files: Awaited<ReturnType<typeof readCloudArchive>>
        manifest: CloudProjectManifest
      }
    >()
    for (const entry of await fileSystem.readDirectory(library.path)) {
      if (entry.kind !== 'directory' || entry.name.startsWith('.')) continue
      const path = joinPath(library.path, entry.name)
      const files = await readCloudArchive(fileSystem, path)
      if (
        !files.some((file) => file.relativePath.toLowerCase().endsWith('.kcl'))
      )
        continue
      projects.set(entry.name, {
        path,
        files,
        manifest: await manifestOf(files),
      })
    }
    return projects
  }

  const materialize = async (
    library: ProjectLibrary,
    remote: RemoteCloudProject,
    taken: Set<string>,
    preferredName?: string
  ) => {
    const requested =
      preferredName ?? toDirectoryName(remote.title ?? 'untitled')
    const name = preferredName ?? uniqueName(requested, taken)
    const path = joinPath(library.path, name)
    const files = await parseCloudArchive(await api.downloadProject(remote.id))
    await writeCloudArchive(fileSystem, path, files)
    taken.add(name)
    return {
      localName: name,
      remoteProjectId: remote.id,
      remoteRevision: revisionOf(remote),
      remoteUpdatedAt: remote.updated_at,
      baseManifest: await manifestOf(files),
    } satisfies SyncRecord
  }

  const reconcile = async (library: ProjectLibrary) => {
    if (!token.value) {
      remoteProjects.value = []
      status.value = { enabled: false, state: 'disabled', conflictCount: 0 }
      return
    }

    registeredLibraries.set(library.id, library)
    status.value = {
      ...status.value,
      enabled: true,
      state: 'syncing',
      activeLibraryId: library.id,
      error: undefined,
    }

    const [index, remotes, locals] = await Promise.all([
      readIndex(library),
      api.listProjects(),
      localProjects(library),
    ])
    remoteProjects.value = remotes
    const remoteById = new Map(remotes.map((remote) => [remote.id, remote]))
    const claimedLocalNames = new Set<string>()

    // First reconcile relationships we already know. An absent remote is
    // recreated from the local materialization: disappearance is not authority
    // to destroy local work.
    for (const record of [...index.projects]) {
      const local = locals.get(record.localName)
      const remote = remoteById.get(record.remoteProjectId)

      if (!local && remote) {
        const replacement = await materialize(
          library,
          remote,
          new Set(locals.keys()),
          record.localName
        )
        Object.assign(record, replacement)
        await writeIndex(library, index)
        claimedLocalNames.add(record.localName)
        continue
      }
      if (!local) {
        index.projects.splice(index.projects.indexOf(record), 1)
        await writeIndex(library, index)
        continue
      }

      claimedLocalNames.add(record.localName)
      if (!remote) {
        const created = await api.createProject(local.path, local.files)
        record.remoteProjectId = created.id
        record.remoteRevision = revisionOf(created)
        record.remoteUpdatedAt = created.updated_at
        record.baseManifest = local.manifest
        record.conflict = undefined
        await writeIndex(library, index)
        continue
      }

      const localChanged = !manifestsEqual(local.manifest, record.baseManifest)
      const currentRevision = revisionOf(remote)
      const remoteChanged = currentRevision !== record.remoteRevision

      if (record.conflict || (localChanged && remoteChanged)) {
        record.conflict ??= {
          remoteRevision: currentRevision,
          detectedAt: Date.now(),
        }
        await writeIndex(library, index)
        continue
      }

      if (localChanged) {
        try {
          const fullRemote = await api.getProject(remote.id)
          const updated = await api.updateProject(
            fullRemote,
            local.path,
            local.files,
            record.remoteRevision
          )
          record.remoteRevision = revisionOf(updated)
          record.remoteUpdatedAt = updated.updated_at
          record.baseManifest = local.manifest
          await writeIndex(library, index)
        } catch (error) {
          if (
            error instanceof CloudApiError &&
            [409, 412].includes(error.status)
          ) {
            record.conflict = {
              remoteRevision: currentRevision,
              detectedAt: Date.now(),
            }
            await writeIndex(library, index)
            continue
          }
          throw error
        }
        continue
      }

      if (remoteChanged) {
        const files = await parseCloudArchive(
          await api.downloadProject(remote.id)
        )
        await writeCloudArchive(fileSystem, local.path, files)
        record.remoteRevision = currentRevision
        record.remoteUpdatedAt = remote.updated_at
        record.baseManifest = await manifestOf(files)
        await writeIndex(library, index)
      }
    }

    // Local projects become cloud projects. This is deliberate enrollment by
    // virtue of living in a Cloud library; directory libraries are never read.
    for (const [name, local] of locals) {
      if (claimedLocalNames.has(name)) continue
      const created = await api.createProject(local.path, local.files)
      index.projects.push({
        localName: name,
        remoteProjectId: created.id,
        remoteRevision: revisionOf(created),
        remoteUpdatedAt: created.updated_at,
        baseManifest: local.manifest,
      })
      await writeIndex(library, index)
    }

    // Anything left in the remote index has never been materialized here.
    const claimedRemoteIds = new Set(
      index.projects.map((record) => record.remoteProjectId)
    )
    const taken = new Set([
      ...locals.keys(),
      ...index.projects.map((record) => record.localName),
    ])
    for (const remote of remotes) {
      if (claimedRemoteIds.has(remote.id)) continue
      index.projects.push(await materialize(library, remote, taken))
      await writeIndex(library, index)
    }

    setIdle(index.projects.filter((record) => record.conflict).length)
  }

  const syncLibrary = (library: ProjectLibrary): Promise<void> => {
    if (disposed) return Promise.resolve()
    const existing = running.get(library.id)
    if (existing) return existing

    const run = reconcile(library)
      .catch((error) => {
        status.value = {
          ...status.value,
          enabled: Boolean(token.value),
          state: token.value ? 'error' : 'disabled',
          activeLibraryId: library.id,
          error: errorMessage(error),
        }
        throw error
      })
      .finally(() => running.delete(library.id))
    running.set(library.id, run)
    return run
  }

  const interval =
    backgroundIntervalMs > 0
      ? setInterval(() => {
          if (!token.value || disposed) return
          for (const library of registeredLibraries.values()) {
            void syncLibrary(library).catch(() => {})
          }
        }, backgroundIntervalMs)
      : undefined

  const onVisibility = () => {
    if (document.visibilityState !== 'visible' || !token.value) return
    for (const library of registeredLibraries.values()) {
      void syncLibrary(library).catch(() => {})
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }

  return {
    status: computed(() => status.value),
    remoteProjects: computed(() => remoteProjects.value),
    syncLibrary,
    syncProject: async (library) => syncLibrary(library),

    async relocateProject(library, fromPath, toPath) {
      const index = await readIndex(library)
      const record = index.projects.find(
        (candidate) => candidate.localName === basename(normalizePath(fromPath))
      )
      if (!record) return
      record.localName = basename(normalizePath(toPath))
      await writeIndex(library, index)
    },

    async deleteProject(library, projectPath) {
      const index = await readIndex(library)
      const name = basename(normalizePath(projectPath))
      const record = index.projects.find(
        (candidate) => candidate.localName === name
      )
      if (record) await api.deleteProject(record.remoteProjectId)
      if (await fileSystem.exists(projectPath))
        await fileSystem.remove(projectPath)
      index.projects = index.projects.filter(
        (candidate) => candidate !== record
      )
      await writeIndex(library, index)
      await syncLibrary(library)
    },

    async disconnectProject(library, projectPath) {
      const index = await readIndex(library)
      const name = basename(normalizePath(projectPath))
      const record = index.projects.find(
        (candidate) => candidate.localName === name
      )
      if (!record) return
      await api.deleteProject(record.remoteProjectId)
      index.projects = index.projects.filter(
        (candidate) => candidate !== record
      )
      await writeIndex(library, index)
    },

    async remoteProjectId(library, projectPath) {
      const name = basename(normalizePath(projectPath))
      return (await readIndex(library)).projects.find(
        (record) => record.localName === name
      )?.remoteProjectId
    },

    async resolveConflict(library, projectPath, resolution) {
      const index = await readIndex(library)
      const name = basename(normalizePath(projectPath))
      const record = index.projects.find(
        (candidate) => candidate.localName === name
      )
      if (!record?.conflict) return
      const remote = await api.getProject(record.remoteProjectId)

      if (resolution === 'remote') {
        const files = await parseCloudArchive(
          await api.downloadProject(remote.id)
        )
        await writeCloudArchive(fileSystem, projectPath, files)
        record.baseManifest = await manifestOf(files)
      } else {
        const files = await readCloudArchive(fileSystem, projectPath)
        const updated = await api.updateProject(
          remote,
          projectPath,
          files,
          revisionOf(remote)
        )
        record.baseManifest = await manifestOf(files)
        record.remoteRevision = revisionOf(updated)
        record.remoteUpdatedAt = updated.updated_at
      }
      record.remoteRevision ??= revisionOf(remote)
      record.remoteUpdatedAt ??= remote.updated_at
      record.conflict = undefined
      await writeIndex(library, index)
      await syncLibrary(library)
    },

    dispose() {
      disposed = true
      if (interval !== undefined) clearInterval(interval)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    },
  }
}
