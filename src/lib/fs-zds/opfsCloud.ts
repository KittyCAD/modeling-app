import { signal } from '@preact/signals-core'
import env from '@src/env'
import { PROJECT_FOLDER, PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import opfs from '@src/lib/fs-zds/opfs'
import {
  CloudApiError,
  createRemoteProject,
  deleteRemoteProject,
  downloadRemoteProjectArchive,
  getRemoteProject,
  listRemoteProjects,
  updateRemoteProject,
} from '@src/lib/fs-zds/opfsCloud/cloudApi'
import {
  INTERNAL_OPFS_META_FILE,
  getOpfsCloudProjectRoot,
  isOpfsCloudProjectDirectoryPath,
  isProjectRootPath,
  normalizePathForSync,
  normalizeRelativePath,
} from '@src/lib/fs-zds/opfsCloud/paths'
import {
  parseProjectArchive,
  projectManifestFromFiles,
  projectManifestsEqual,
  toArrayBuffer,
  withProjectTitleInArchiveFiles,
  withRemoteProjectMetadataInArchiveFiles,
} from '@src/lib/fs-zds/opfsCloud/projectArchive'
import {
  appendOutboxEntry as appendSyncDbOutboxEntry,
  clearOutboxEntriesForProject as clearSyncDbOutboxEntriesForProject,
  deleteProjectMetadata,
  getAllOutboxEntries,
  getAllProjectMetadata,
  getProjectMetadata,
  putProjectMetadata,
} from '@src/lib/fs-zds/opfsCloud/syncDb'
import type {
  OPFSCloudConfig,
  OPFSCloudSyncStatus,
  OpfsCloudLocalProject,
  OpfsCloudProjectMetadataIndexEntry,
  OutboxEntry,
  ProjectArchiveFile,
  ProjectManifest,
  ProjectMetadata,
  RemoteProject,
  Revision,
} from '@src/lib/fs-zds/opfsCloud/types'
import { webSafePathSplit } from '@src/lib/pathUtils'
import { sanitizeProjectName } from '@src/lib/projectName'
import {
  getCloudProjectIdFromProjectTomlContents,
  getProjectTitleFromProjectTomlContents,
  setCloudProjectIdInProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'

export type {
  OPFSCloudOptions,
  OPFSCloudSyncState,
  OPFSCloudSyncStatus,
  OpfsCloudLocalProject,
  OpfsCloudProjectMetadataIndexEntry,
  OutboxEntry,
  ProjectArchiveFile,
  ProjectManifest,
  ProjectMetadata,
} from '@src/lib/fs-zds/opfsCloud/types'
export {
  getOpfsCloudProjectMetadata,
  getOpfsCloudProjectMetadataIndex,
} from '@src/lib/fs-zds/opfsCloud/syncDb'
export { getOpfsCloudProjectRoot } from '@src/lib/fs-zds/opfsCloud/paths'
export {
  prepareProjectFilesForCloudUpload,
  projectManifestsEqual,
} from '@src/lib/fs-zds/opfsCloud/projectArchive'

const SYNC_DEBOUNCE_MS = 2500
const SYNC_RETRY_MS = 30_000
const REMOTE_INDEX_INTERVAL_MS = 5 * 60 * 1000

const localFs = opfs.impl

let config: OPFSCloudConfig = {
  enabled: false,
}
let syncTimer: ReturnType<typeof setTimeout> | undefined
let syncInProgress = false
let lastRemoteIndexSyncAt = 0
let initialLocalScanComplete = false
let pendingStatusSyncedAt: string | undefined
let detachVisibilityChangeListener: (() => void) | undefined
let syncScopeProjectPath: string | undefined

export const opfsCloudSyncStatus = signal<OPFSCloudSyncStatus>({
  enabled: false,
  state: 'disabled',
  pendingCount: 0,
})

function updateStatus(next: Partial<OPFSCloudSyncStatus>) {
  opfsCloudSyncStatus.value = {
    ...opfsCloudSyncStatus.value,
    ...next,
  }
}

function nowIso() {
  return new Date().toISOString()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getConfiguredProjectDirectoryPath() {
  return normalizePathForSync(
    config.projectDirectoryPath?.trim() ||
      localFs.join(`${localFs.sep}documents`, PROJECT_FOLDER)
  )
}

function projectNameFromPath(projectPath: string) {
  return localFs.basename(normalizePathForSync(projectPath))
}

function isProjectPathInDirectory(
  projectPath: string,
  projectDirectory: string
) {
  return (
    localFs.dirname(normalizePathForSync(projectPath)) ===
    normalizePathForSync(projectDirectory)
  )
}

function projectPathInDirectory(
  metadata: ProjectMetadata,
  projectDirectory: string
) {
  return isProjectPathInDirectory(metadata.localProjectPath, projectDirectory)
    ? metadata.localProjectPath
    : undefined
}

function isInternalOpfsPath(targetPath: string) {
  return webSafePathSplit(normalizePathForSync(targetPath)).includes(
    INTERNAL_OPFS_META_FILE
  )
}

function isConfiguredForCloud() {
  return config.enabled === true
}

function getSyncScopeProjectPath(projectPath: string | undefined) {
  if (!projectPath) {
    return undefined
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  return isProjectPathInDirectory(
    normalizedProjectPath,
    getConfiguredProjectDirectoryPath()
  )
    ? normalizedProjectPath
    : undefined
}

function projectPathMatchesSyncScope(projectPath: string) {
  return (
    !syncScopeProjectPath ||
    normalizePathForSync(projectPath) === syncScopeProjectPath
  )
}

function outboxEntriesForProject(entries: OutboxEntry[], projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  return entries.filter(
    (entry) => normalizePathForSync(entry.projectPath) === normalizedProjectPath
  )
}

export type OpfsCloudSyncScopePlan = {
  shouldSyncRemoteIndex: boolean
  projectPaths: string[]
  pendingCount: number
}

export function getOpfsCloudSyncScopePlan(
  entries: OutboxEntry[],
  scopeProjectPath?: string
): OpfsCloudSyncScopePlan {
  const normalizedScopeProjectPath = scopeProjectPath
    ? normalizePathForSync(scopeProjectPath)
    : undefined
  if (normalizedScopeProjectPath) {
    return {
      shouldSyncRemoteIndex: false,
      projectPaths: [normalizedScopeProjectPath],
      pendingCount: outboxEntriesForProject(entries, normalizedScopeProjectPath)
        .length,
    }
  }

  return {
    shouldSyncRemoteIndex: true,
    projectPaths: Array.from(
      new Set(entries.map((entry) => normalizePathForSync(entry.projectPath)))
    ),
    pendingCount: entries.length,
  }
}

function getEnvironmentName() {
  if (config.environmentName) {
    return config.environmentName
  }

  const baseDomain = env().VITE_ZOO_BASE_DOMAIN
  if (baseDomain) {
    return baseDomain
  }

  const apiBaseUrl = env().VITE_ZOO_API_BASE_URL
  if (apiBaseUrl) {
    return new URL(apiBaseUrl).hostname.replace(/^api\./, '')
  }

  return undefined
}

function getRevision(project: RemoteProject | undefined): Revision | undefined {
  if (!project) {
    return undefined
  }
  const revision = project.revision ?? project.updated_at
  if (revision === undefined || revision === null) {
    return undefined
  }
  return String(revision)
}

function getRemoteUpdatedAt(project: RemoteProject | undefined) {
  if (!project?.updated_at || Number.isNaN(Date.parse(project.updated_at))) {
    return undefined
  }

  return project.updated_at
}

function localProjectNameForRemoteProject(remoteProject: RemoteProject) {
  return sanitizeProjectName(remoteProject.id, 'cloud-project')
}

function remoteSyncMetadata(
  project: RemoteProject | undefined,
  options: { useNowAsUpdatedAtFallback?: boolean } = {}
) {
  return {
    revision: getRevision(project),
    updatedAt:
      getRemoteUpdatedAt(project) ||
      (options.useNowAsUpdatedAtFallback ? nowIso() : undefined),
  }
}

export function getOpfsCloudProjectModifiedTime(
  metadata: OpfsCloudProjectMetadataIndexEntry | undefined,
  localModified: number | null | undefined
) {
  const remoteUpdatedAt = metadata?.remoteUpdatedAt
    ? Date.parse(metadata.remoteUpdatedAt)
    : Number.NaN
  if (!metadata?.hasPendingChanges && !Number.isNaN(remoteUpdatedAt)) {
    return remoteUpdatedAt
  }

  return localModified ?? null
}

async function writeLocalProjectTitle(projectPath: string, title: string) {
  return updateLocalProjectToml(projectPath, (projectToml) =>
    getProjectTitleFromProjectTomlContents(projectToml) === title
      ? projectToml
      : setProjectTitleInProjectTomlContents(projectToml, title)
  )
}

async function writeLocalProjectCloudProjectId(
  projectPath: string,
  projectId: string
) {
  const environmentName = getEnvironmentName()
  if (!environmentName) {
    return false
  }

  return updateLocalProjectToml(projectPath, (projectToml) =>
    getCloudProjectIdFromProjectTomlContents(projectToml, environmentName) ===
    projectId
      ? projectToml
      : setCloudProjectIdInProjectTomlContents(
          projectToml,
          environmentName,
          projectId
        )
  )
}

async function updateLocalProjectToml(
  projectPath: string,
  update: (contents: string) => string
) {
  const projectTomlPath = localFs.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  let projectToml = ''
  if (await exists(projectTomlPath)) {
    projectToml = await localFs.readFile(projectTomlPath, {
      encoding: 'utf-8',
    })
  }

  const nextProjectToml = update(projectToml)
  if (nextProjectToml === projectToml) {
    return false
  }

  await localFs.writeFile(
    projectTomlPath,
    new TextEncoder().encode(nextProjectToml)
  )
  return true
}

async function appendOutboxEntry(entry: Omit<OutboxEntry, 'id'>) {
  await appendSyncDbOutboxEntry(entry)
  await refreshPendingCount()
}

async function clearOutboxEntriesForProject(projectPath: string) {
  await clearSyncDbOutboxEntriesForProject(projectPath)
  await refreshPendingCount()
}

async function refreshPendingCount() {
  try {
    const entries = await getAllOutboxEntries()
    updateStatus({
      pendingCount: getOpfsCloudSyncScopePlan(entries, syncScopeProjectPath)
        .pendingCount,
    })
  } catch {
    updateStatus({ pendingCount: 0 })
  }
}

async function exists(targetPath: string) {
  try {
    await localFs.stat(targetPath)
    return true
  } catch (error) {
    if (error === 'ENOENT') {
      return false
    }
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw error
  }
}

function statIsDirectory(stat: IStat) {
  return Boolean(stat.mode & 0o040000)
}

async function collectLocalProjectFiles(projectRoot: string) {
  const files: ProjectArchiveFile[] = []

  const walk = async (currentPath: string) => {
    const entries = await localFs.readdir(currentPath)
    for (const entry of entries) {
      if (entry === INTERNAL_OPFS_META_FILE) {
        continue
      }

      const absolutePath = localFs.join(currentPath, entry)
      const stat = await localFs.stat(absolutePath)
      if (statIsDirectory(stat)) {
        await walk(absolutePath)
        continue
      }

      const data = await localFs.readFile(absolutePath)
      files.push({
        relativePath: normalizeRelativePath(
          localFs.relative(projectRoot, absolutePath)
        ),
        data: Uint8Array.from(data),
      })
    }
  }

  await walk(projectRoot)
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function replaceLocalProjectWithFiles(
  projectPath: string,
  files: ProjectArchiveFile[]
) {
  if (await exists(projectPath)) {
    await localFs.rm(projectPath, { recursive: true })
  }

  await localFs.mkdir(projectPath, { recursive: true })
  for (const file of files) {
    if (!file.relativePath) {
      continue
    }
    const targetPath = localFs.join(projectPath, file.relativePath)
    await localFs.mkdir(localFs.dirname(targetPath), { recursive: true })
    await localFs.writeFile(
      targetPath,
      new Uint8Array(toArrayBuffer(file.data))
    )
  }
}

async function uniqueProjectPath(
  projectDirectory: string,
  projectName: string
) {
  let candidate = localFs.join(projectDirectory, projectName)
  if (!(await exists(candidate))) {
    return candidate
  }

  let index = 2
  while (await exists(candidate)) {
    candidate = localFs.join(projectDirectory, `${projectName} ${index}`)
    index += 1
  }
  return candidate
}

function localProjectFromMetadata(
  metadata: ProjectMetadata
): OpfsCloudLocalProject | undefined {
  if (!metadata.remoteProjectId) {
    return undefined
  }

  return {
    projectPath: metadata.localProjectPath,
    projectName: metadata.projectName,
    remoteProjectId: metadata.remoteProjectId,
    remoteRevision: metadata.remoteRevision,
  }
}

async function findLocalProjectPathByRemoteProjectId(
  projectDirectory: string,
  remoteProjectId: string,
  preferredProjectName?: string
) {
  const candidateNames = new Set<string>()
  if (preferredProjectName) {
    candidateNames.add(preferredProjectName)
  }

  const entries = await localFs.readdir(projectDirectory).catch((error) => {
    if (error === 'ENOENT') {
      return []
    }
    return Promise.reject(error)
  })
  for (const entry of entries) {
    candidateNames.add(entry)
  }

  for (const entry of candidateNames) {
    if (entry.startsWith('.')) {
      continue
    }
    const candidatePath = localFs.join(projectDirectory, entry)
    if (!(await exists(candidatePath))) {
      continue
    }
    const candidateRemoteProjectId = await readProjectTomlCloudProjectId(
      candidatePath
    ).catch(() => undefined)
    if (candidateRemoteProjectId === remoteProjectId) {
      return candidatePath
    }
  }

  return undefined
}

async function cloneRemoteProjectToLocal(
  remoteProject: RemoteProject,
  projectDirectory = getConfiguredProjectDirectoryPath(),
  preferredProjectPath?: string
): Promise<OpfsCloudLocalProject> {
  await localFs.mkdir(projectDirectory, { recursive: true })
  const projectName = localProjectNameForRemoteProject(remoteProject)
  const projectPath =
    preferredProjectPath && !(await exists(preferredProjectPath))
      ? preferredProjectPath
      : await uniqueProjectPath(projectDirectory, projectName)
  const archive = await downloadRemoteProjectArchive(config, remoteProject.id)
  const files = withRemoteProjectMetadataInArchiveFiles(
    await parseProjectArchive(archive),
    remoteProject.title,
    remoteProject.id,
    getEnvironmentName()
  )
  const nextMetadata = {
    ...metadataForProject(projectPath),
    remoteProjectId: remoteProject.id,
  }

  await replaceLocalProjectWithFiles(projectPath, files)
  await markProjectSynced(
    nextMetadata,
    await projectManifestFromFiles(files),
    remoteSyncMetadata(remoteProject)
  )

  return {
    projectPath,
    projectName: projectNameFromPath(projectPath),
    remoteProjectId: remoteProject.id,
    remoteRevision: getRevision(remoteProject),
  }
}

export async function ensureOpfsCloudProjectLocallySynced(
  remoteProjectId: string
): Promise<OpfsCloudLocalProject | undefined> {
  if (!isConfiguredForCloud()) {
    return undefined
  }

  const projectId = remoteProjectId.trim()
  if (!projectId) {
    return undefined
  }

  const metadata = await getAllProjectMetadata()
  const knownLocalMetadata = metadata.find(
    (entry) => entry.remoteProjectId === projectId && !entry.tombstone
  )
  const projectDirectory = getConfiguredProjectDirectoryPath()
  const knownLocalProjectPath = knownLocalMetadata
    ? projectPathInDirectory(knownLocalMetadata, projectDirectory)
    : undefined
  if (
    knownLocalMetadata &&
    knownLocalProjectPath &&
    (await exists(knownLocalProjectPath))
  ) {
    scheduleSync(0)
    return localProjectFromMetadata(knownLocalMetadata)
  }
  if (knownLocalMetadata) {
    await deleteProjectMetadata(knownLocalMetadata.localProjectPath)
  }

  const remoteProject = await getRemoteProject(config, projectId)
  const projectName = localProjectNameForRemoteProject(remoteProject)
  await localFs.mkdir(projectDirectory, { recursive: true })

  const existingProjectPath = await findLocalProjectPathByRemoteProjectId(
    projectDirectory,
    projectId,
    projectName
  )
  if (existingProjectPath) {
    const nextMetadata = {
      ...(await getOrCreateProjectMetadata(existingProjectPath)),
      remoteProjectId: projectId,
      tombstone: false,
    }
    await putProjectMetadata(nextMetadata)
    scheduleSync(0)
    return localProjectFromMetadata(nextMetadata)
  }

  return cloneRemoteProjectToLocal(
    remoteProject,
    projectDirectory,
    knownLocalProjectPath
  )
}

async function readProjectTomlCloudProjectId(projectPath: string) {
  const environmentName = getEnvironmentName()
  const projectTomlPath = localFs.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  if (!(await exists(projectTomlPath))) {
    return undefined
  }

  const projectToml = await localFs.readFile(projectTomlPath, {
    encoding: 'utf-8',
  })
  const projectIdPattern = /project_id\s*=\s*"([^"]+)"/

  if (environmentName) {
    const escapedEnvironmentName = environmentName.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )
    const sectionPattern = new RegExp(
      `\\[cloud\\."${escapedEnvironmentName}"\\]([\\s\\S]*?)(?=\\n\\[|$)`
    )
    const sectionMatch = sectionPattern.exec(projectToml)
    const projectIdMatch = sectionMatch
      ? projectIdPattern.exec(sectionMatch[1])
      : undefined
    if (projectIdMatch?.[1]) {
      return projectIdMatch[1]
    }
  }

  return projectIdPattern.exec(projectToml)?.[1]
}

function metadataForProject(projectPath: string): ProjectMetadata {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  return {
    schemaVersion: 1,
    localProjectPath: normalizedProjectPath,
    projectName: projectNameFromPath(normalizedProjectPath),
  }
}

async function getOrCreateProjectMetadata(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const existing = await getProjectMetadata(normalizedProjectPath)
  if (existing) {
    return existing
  }

  return metadataForProject(normalizedProjectPath)
}

async function bindRemoteProjectIdFromToml(metadata: ProjectMetadata) {
  if (metadata.remoteProjectId) {
    return metadata
  }

  const projectId = await readProjectTomlCloudProjectId(
    metadata.localProjectPath
  ).catch(() => undefined)
  if (!projectId) {
    return metadata
  }

  const next = {
    ...metadata,
    remoteProjectId: projectId,
  }
  await putProjectMetadata(next)
  return next
}

async function markProjectFailure(
  metadata: ProjectMetadata,
  error: unknown
): Promise<void> {
  const message = errorMessage(error)
  const next = {
    ...metadata,
    lastFailure: {
      message,
      at: nowIso(),
    },
  }
  await putProjectMetadata(next)
  if (projectPathMatchesSyncScope(metadata.localProjectPath)) {
    updateStatus({
      state: 'failed',
      activeProjectPath: metadata.localProjectPath,
      lastFailure: message,
      lastFailureAt: next.lastFailure.at,
    })
  }
}

function markCloudMetadataFailure(error: unknown) {
  if (!isConfiguredForCloud()) {
    return
  }

  initialLocalScanComplete = false
  updateStatus({
    enabled: true,
    state: 'failed',
    lastFailure: errorMessage(error),
    lastFailureAt: nowIso(),
  })
  scheduleSync(SYNC_RETRY_MS)
}

async function markProjectSynced(
  metadata: ProjectMetadata,
  baseManifest: ProjectManifest,
  remote?: {
    revision?: Revision
    updatedAt?: string
  }
) {
  const syncedAt = nowIso()
  await putProjectMetadata({
    ...metadata,
    baseManifest,
    remoteRevision: remote?.revision ?? metadata.remoteRevision,
    remoteUpdatedAt: remote?.updatedAt ?? metadata.remoteUpdatedAt,
    tombstone: false,
    conflict: undefined,
    lastFailure: undefined,
    lastSyncedAt: syncedAt,
  })
  if (!projectPathMatchesSyncScope(metadata.localProjectPath)) {
    return
  }

  if (syncInProgress) {
    pendingStatusSyncedAt = syncedAt
    updateStatus({
      lastSyncedAt: syncedAt,
      lastFailure: undefined,
      lastFailureAt: undefined,
    })
    return
  }

  updateStatus({
    state: 'idle',
    activeProjectPath: undefined,
    lastSyncedAt: syncedAt,
    lastFailure: undefined,
    lastFailureAt: undefined,
  })
}

async function hydrateCleanLocalProjectTitle(
  metadata: ProjectMetadata,
  remoteTitle?: string
) {
  if (!remoteTitle?.trim() || !(await exists(metadata.localProjectPath))) {
    return metadata
  }

  const projectTomlPath = localFs.join(
    metadata.localProjectPath,
    PROJECT_SETTINGS_FILE_NAME
  )
  const existingProjectToml = (await exists(projectTomlPath))
    ? await localFs.readFile(projectTomlPath, { encoding: 'utf-8' })
    : ''
  if (
    getProjectTitleFromProjectTomlContents(existingProjectToml) === remoteTitle
  ) {
    return metadata
  }

  const beforeFiles = await collectLocalProjectFiles(metadata.localProjectPath)
  const beforeManifest = await projectManifestFromFiles(beforeFiles)
  const localClean =
    !metadata.baseManifest ||
    projectManifestsEqual(beforeManifest, metadata.baseManifest)
  if (!localClean) {
    return metadata
  }

  const titleChanged = await writeLocalProjectTitle(
    metadata.localProjectPath,
    remoteTitle
  )
  if (!titleChanged) {
    return metadata
  }

  const afterFiles = await collectLocalProjectFiles(metadata.localProjectPath)
  const nextMetadata = {
    ...metadata,
    baseManifest: await projectManifestFromFiles(afterFiles),
  }
  await putProjectMetadata(nextMetadata)
  return nextMetadata
}

async function markProjectConflict(
  metadata: ProjectMetadata,
  remoteRevision: Revision | undefined,
  remoteFiles: ProjectArchiveFile[],
  remoteTitle?: string
) {
  const parentDirectory = localFs.dirname(metadata.localProjectPath)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const conflictName = `${metadata.projectName} (cloud conflict ${stamp})`
  const conflictProjectPath = await uniqueProjectPath(
    parentDirectory,
    conflictName
  )

  await replaceLocalProjectWithFiles(
    conflictProjectPath,
    withProjectTitleInArchiveFiles(remoteFiles, remoteTitle)
  )

  await putProjectMetadata({
    ...metadata,
    conflict: {
      remoteRevision,
      conflictProjectPath,
      createdAt: nowIso(),
    },
    lastFailure: {
      message: 'Cloud sync conflict: local and remote both changed.',
      at: nowIso(),
    },
  })
  if (projectPathMatchesSyncScope(metadata.localProjectPath)) {
    updateStatus({
      state: 'conflict',
      activeProjectPath: metadata.localProjectPath,
      lastFailure: 'Cloud sync conflict: local and remote both changed.',
      lastFailureAt: nowIso(),
    })
  }
}

function latestOutboxKind(entries: OutboxEntry[]) {
  return entries.toSorted((a, b) => (a.id ?? 0) - (b.id ?? 0)).at(-1)?.kind
}

export type OpfsCloudProjectSyncPreflightAction =
  | 'delete-remote'
  | 'forget-missing-local'
  | 'create-remote'
  | 'mark-synced'
  | 'push-local-with-expected-revision'
  | 'compare-remote-archive'

export function getOpfsCloudProjectSyncPreflightAction({
  latestKind,
  tombstone,
  localProjectExists,
  hasRemoteProjectId,
  localChanged,
  remoteChanged,
  hasRemoteRevision,
}: {
  latestKind?: OutboxEntry['kind']
  tombstone?: boolean
  localProjectExists: boolean
  hasRemoteProjectId: boolean
  localChanged: boolean
  remoteChanged: boolean
  hasRemoteRevision: boolean
}): OpfsCloudProjectSyncPreflightAction {
  if (latestKind === 'delete' || tombstone) {
    return 'delete-remote'
  }
  if (!localProjectExists) {
    return 'forget-missing-local'
  }
  if (!hasRemoteProjectId) {
    return 'create-remote'
  }
  if (!localChanged && !remoteChanged) {
    return 'mark-synced'
  }
  if (localChanged && !remoteChanged && hasRemoteRevision) {
    return 'push-local-with-expected-revision'
  }
  return 'compare-remote-archive'
}

export type OpfsCloudRemoteArchiveReconciliationAction =
  | 'mark-synced'
  | 'hydrate-clean-local'
  | 'mark-conflict'

export function getOpfsCloudRemoteArchiveReconciliationAction({
  hasBaseManifest,
  localMatchesRemote,
  localClean,
}: {
  hasBaseManifest: boolean
  localMatchesRemote: boolean
  localClean: boolean
}): OpfsCloudRemoteArchiveReconciliationAction {
  if (!hasBaseManifest && localMatchesRemote) {
    return 'mark-synced'
  }
  if (localClean) {
    return 'hydrate-clean-local'
  }
  if (localMatchesRemote) {
    return 'mark-synced'
  }
  return 'mark-conflict'
}

export type OpfsCloudRemoteIndexAction =
  | 'skip'
  | 'sync-known-local'
  | 'adopt-matching-local'
  | 'clone-remote'

export function getOpfsCloudRemoteIndexAction({
  hasRemoteProjectId,
  isRemoteProjectTombstoned,
  hasKnownLocalMetadata,
  hasMatchingLocalProject,
}: {
  hasRemoteProjectId: boolean
  isRemoteProjectTombstoned: boolean
  hasKnownLocalMetadata: boolean
  hasMatchingLocalProject: boolean
}): OpfsCloudRemoteIndexAction {
  if (!hasRemoteProjectId || isRemoteProjectTombstoned) {
    return 'skip'
  }
  if (hasKnownLocalMetadata) {
    return 'sync-known-local'
  }
  if (hasMatchingLocalProject) {
    return 'adopt-matching-local'
  }
  return 'clone-remote'
}

async function syncDeletedProject(metadata: ProjectMetadata) {
  if (metadata.remoteProjectId) {
    try {
      await deleteRemoteProject(config, metadata.remoteProjectId)
    } catch (error) {
      if (!(error instanceof CloudApiError && error.status === 404)) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw error
      }
    }
  }

  await clearOutboxEntriesForProject(metadata.localProjectPath)
  await deleteProjectMetadata(metadata.localProjectPath)
}

async function syncProject(projectPath: string, entries: OutboxEntry[]) {
  let metadata = await getOrCreateProjectMetadata(projectPath)
  if (projectPathMatchesSyncScope(metadata.localProjectPath)) {
    updateStatus({
      state: 'syncing',
      activeProjectPath: metadata.localProjectPath,
    })
  }

  try {
    const latestKind = latestOutboxKind(entries)
    const localProjectExists = await exists(metadata.localProjectPath)
    const initialAction = getOpfsCloudProjectSyncPreflightAction({
      latestKind,
      tombstone: metadata.tombstone,
      localProjectExists,
      hasRemoteProjectId: Boolean(metadata.remoteProjectId),
      localChanged: false,
      remoteChanged: false,
      hasRemoteRevision: Boolean(metadata.remoteRevision),
    })
    if (initialAction === 'delete-remote') {
      await syncDeletedProject(metadata)
      return
    }

    if (initialAction === 'forget-missing-local') {
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      return
    }

    metadata = await bindRemoteProjectIdFromToml(metadata)
    if (metadata.remoteProjectId) {
      await writeLocalProjectCloudProjectId(
        metadata.localProjectPath,
        metadata.remoteProjectId
      )
    }
    const localFiles = await collectLocalProjectFiles(metadata.localProjectPath)
    const localManifest = await projectManifestFromFiles(localFiles)

    let remoteProject: RemoteProject | undefined
    let remoteRevision: Revision | undefined
    let remoteChanged = false
    let localChanged = true
    if (metadata.remoteProjectId) {
      remoteProject = await getRemoteProject(config, metadata.remoteProjectId)
      remoteRevision = getRevision(remoteProject)
      remoteChanged =
        Boolean(metadata.remoteRevision && remoteRevision) &&
        metadata.remoteRevision !== remoteRevision
      localChanged = metadata.baseManifest
        ? !projectManifestsEqual(localManifest, metadata.baseManifest)
        : true
    }

    const preflightAction = getOpfsCloudProjectSyncPreflightAction({
      latestKind,
      tombstone: metadata.tombstone,
      localProjectExists,
      hasRemoteProjectId: Boolean(metadata.remoteProjectId),
      localChanged,
      remoteChanged,
      hasRemoteRevision: Boolean(metadata.remoteRevision),
    })

    if (preflightAction === 'create-remote') {
      const created = await createRemoteProject(
        config,
        metadata.localProjectPath,
        localFiles
      )
      await writeLocalProjectCloudProjectId(
        metadata.localProjectPath,
        created.id
      )
      const nextLocalFiles = await collectLocalProjectFiles(
        metadata.localProjectPath
      )
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        {
          ...metadata,
          remoteProjectId: created.id,
        },
        await projectManifestFromFiles(nextLocalFiles),
        remoteSyncMetadata(created, { useNowAsUpdatedAtFallback: true })
      )
      return
    }

    const remoteProjectId = metadata.remoteProjectId
    if (!remoteProjectId) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new Error('Cloud sync expected an existing remote project id.')
    }
    if (!remoteProject) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new Error('Cloud sync expected remote project metadata.')
    }

    if (preflightAction === 'mark-synced') {
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        localManifest,
        remoteSyncMetadata(remoteProject)
      )
      return
    }

    if (preflightAction === 'push-local-with-expected-revision') {
      const updated = await updateRemoteProject({
        config,
        projectPath: metadata.localProjectPath,
        projectId: remoteProjectId,
        files: localFiles,
        expectedRevision: metadata.remoteRevision,
      })
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        localManifest,
        remoteSyncMetadata(updated, { useNowAsUpdatedAtFallback: true })
      )
      return
    }

    const remoteArchive = await downloadRemoteProjectArchive(
      config,
      remoteProjectId
    )
    const remoteFiles = withRemoteProjectMetadataInArchiveFiles(
      await parseProjectArchive(remoteArchive),
      remoteProject.title,
      remoteProjectId,
      getEnvironmentName()
    )
    const remoteManifest = await projectManifestFromFiles(remoteFiles)

    const localMatchesRemote = projectManifestsEqual(
      localManifest,
      remoteManifest
    )
    const reconciliationAction = getOpfsCloudRemoteArchiveReconciliationAction({
      hasBaseManifest: Boolean(metadata.baseManifest),
      localMatchesRemote,
      localClean: Boolean(
        metadata.baseManifest &&
          projectManifestsEqual(localManifest, metadata.baseManifest)
      ),
    })

    if (reconciliationAction === 'mark-synced') {
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        localManifest,
        remoteSyncMetadata(remoteProject)
      )
      return
    }

    if (reconciliationAction === 'hydrate-clean-local') {
      await replaceLocalProjectWithFiles(metadata.localProjectPath, remoteFiles)
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        remoteManifest,
        remoteSyncMetadata(remoteProject)
      )
      return
    }

    await markProjectConflict(
      metadata,
      remoteRevision,
      remoteFiles,
      remoteProject?.title
    )
  } catch (error) {
    await markProjectFailure(metadata, error)
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw error
  }
}

async function syncRemoteIndex() {
  const now = Date.now()
  if (now - lastRemoteIndexSyncAt < REMOTE_INDEX_INTERVAL_MS) {
    return
  }

  const projectDirectory = getConfiguredProjectDirectoryPath()
  await localFs.mkdir(projectDirectory, { recursive: true })

  const remoteProjects = await listRemoteProjects(config)
  let metadata = await getAllProjectMetadata()
  const pendingProjectPaths = new Set(
    (await getAllOutboxEntries()).map((entry) =>
      normalizePathForSync(entry.projectPath)
    )
  )
  const tombstonedRemoteProjectIds = new Set(
    metadata
      .filter((entry) => entry.tombstone && entry.remoteProjectId)
      .map((entry) => entry.remoteProjectId)
  )
  const failures: unknown[] = []

  const upsertMetadata = (nextMetadata: ProjectMetadata) => {
    metadata = [
      ...metadata.filter(
        (entry) =>
          normalizePathForSync(entry.localProjectPath) !==
          normalizePathForSync(nextMetadata.localProjectPath)
      ),
      nextMetadata,
    ]
  }

  for (const remoteProject of remoteProjects) {
    const skipAction = getOpfsCloudRemoteIndexAction({
      hasRemoteProjectId: Boolean(remoteProject.id),
      isRemoteProjectTombstoned: Boolean(
        remoteProject.id && tombstonedRemoteProjectIds.has(remoteProject.id)
      ),
      hasKnownLocalMetadata: false,
      hasMatchingLocalProject: false,
    })
    if (skipAction === 'skip') {
      continue
    }

    try {
      const knownLocalMetadata = metadata.find(
        (entry) => entry.remoteProjectId === remoteProject.id
      )
      const knownLocalAction = getOpfsCloudRemoteIndexAction({
        hasRemoteProjectId: Boolean(remoteProject.id),
        isRemoteProjectTombstoned: false,
        hasKnownLocalMetadata: Boolean(knownLocalMetadata),
        hasMatchingLocalProject: false,
      })
      if (knownLocalAction === 'sync-known-local' && knownLocalMetadata) {
        const knownLocalProjectPath = projectPathInDirectory(
          knownLocalMetadata,
          projectDirectory
        )
        const knownLocalPathIsCurrent =
          knownLocalProjectPath && (await exists(knownLocalProjectPath))
        if (!knownLocalPathIsCurrent) {
          await deleteProjectMetadata(knownLocalMetadata.localProjectPath)
          metadata = metadata.filter((entry) => entry !== knownLocalMetadata)
          const clonedProject = await cloneRemoteProjectToLocal(
            remoteProject,
            projectDirectory,
            knownLocalProjectPath
          )
          const clonedMetadata = await getProjectMetadata(
            clonedProject.projectPath
          )
          if (clonedMetadata) {
            upsertMetadata(clonedMetadata)
          }
          continue
        }

        const hasPendingLocalChanges = pendingProjectPaths.has(
          normalizePathForSync(knownLocalMetadata.localProjectPath)
        )
        const nextLocalMetadata = hasPendingLocalChanges
          ? knownLocalMetadata
          : await hydrateCleanLocalProjectTitle(
              knownLocalMetadata,
              remoteProject.title
            )
        const remoteRevision = getRevision(remoteProject)
        if (
          remoteRevision &&
          nextLocalMetadata.remoteRevision &&
          remoteRevision !== nextLocalMetadata.remoteRevision
        ) {
          if (hasPendingLocalChanges) {
            const remoteUpdatedAt = getRemoteUpdatedAt(remoteProject)
            if (remoteUpdatedAt) {
              const indexedMetadata = {
                ...nextLocalMetadata,
                remoteUpdatedAt,
              }
              await putProjectMetadata(indexedMetadata)
              upsertMetadata(indexedMetadata)
            }
            continue
          }

          await syncProject(nextLocalMetadata.localProjectPath, [])
          const syncedMetadata = await getProjectMetadata(
            nextLocalMetadata.localProjectPath
          )
          if (syncedMetadata) {
            upsertMetadata(syncedMetadata)
          }
        } else {
          const remoteUpdatedAt = getRemoteUpdatedAt(remoteProject)
          const indexedMetadata = remoteUpdatedAt
            ? {
                ...nextLocalMetadata,
                remoteUpdatedAt,
              }
            : nextLocalMetadata
          if (indexedMetadata !== nextLocalMetadata) {
            await putProjectMetadata(indexedMetadata)
          }
          upsertMetadata(indexedMetadata)
        }
        continue
      }

      const projectName = localProjectNameForRemoteProject(remoteProject)
      const existingProjectPath = await findLocalProjectPathByRemoteProjectId(
        projectDirectory,
        remoteProject.id,
        projectName
      )
      const existingLocalAction = getOpfsCloudRemoteIndexAction({
        hasRemoteProjectId: Boolean(remoteProject.id),
        isRemoteProjectTombstoned: false,
        hasKnownLocalMetadata: false,
        hasMatchingLocalProject: Boolean(existingProjectPath),
      })
      if (existingProjectPath) {
        const nextMetadata = {
          ...(await getOrCreateProjectMetadata(existingProjectPath)),
          remoteProjectId: remoteProject.id,
          remoteUpdatedAt: getRemoteUpdatedAt(remoteProject),
        }
        await putProjectMetadata(nextMetadata)
        upsertMetadata(nextMetadata)
        await syncProject(existingProjectPath, [])
        const syncedMetadata = await getProjectMetadata(existingProjectPath)
        if (syncedMetadata) {
          upsertMetadata(syncedMetadata)
        }
        continue
      }

      if (existingLocalAction !== 'clone-remote') {
        continue
      }

      const clonedProject = await cloneRemoteProjectToLocal(
        remoteProject,
        projectDirectory
      )
      const clonedMetadata = await getProjectMetadata(clonedProject.projectPath)
      if (clonedMetadata) {
        upsertMetadata(clonedMetadata)
      }
    } catch (error) {
      failures.push(error)
    }
  }

  if (failures.length > 0) {
    return Promise.reject(
      new Error(
        `Cloud sync failed for ${failures.length} remote project${
          failures.length === 1 ? '' : 's'
        }: ${errorMessage(failures.at(-1))}`
      )
    )
  }

  lastRemoteIndexSyncAt = Date.now()
}

async function enqueueExistingLocalProjectsForInitialSync() {
  if (initialLocalScanComplete) {
    return
  }

  const projectDirectory = getConfiguredProjectDirectoryPath()
  if (!(await exists(projectDirectory))) {
    initialLocalScanComplete = true
    return
  }

  const entries = await localFs.readdir(projectDirectory)
  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue
    }
    const projectPath = localFs.join(projectDirectory, entry)
    const stat = await localFs.stat(projectPath)
    if (!statIsDirectory(stat)) {
      continue
    }

    const metadata = await getProjectMetadata(projectPath)
    if (metadata?.baseManifest && !metadata.tombstone) {
      continue
    }

    await registerProjectMutation(projectPath, 'upsert', projectPath)
  }

  initialLocalScanComplete = true
}

async function runCloudSync() {
  if (!isConfiguredForCloud()) {
    return
  }
  if (syncInProgress) {
    scheduleSync(SYNC_DEBOUNCE_MS)
    return
  }

  syncInProgress = true
  pendingStatusSyncedAt = undefined
  updateStatus({ enabled: true, state: 'syncing' })
  const scopedProjectPath = syncScopeProjectPath
  let remoteIndexFailed = false
  let remoteIndexFailureMessage: string | undefined

  try {
    let entries = await getAllOutboxEntries()
    let syncScopePlan = getOpfsCloudSyncScopePlan(entries, scopedProjectPath)
    if (syncScopePlan.shouldSyncRemoteIndex) {
      await enqueueExistingLocalProjectsForInitialSync()
      await syncRemoteIndex().catch((error) => {
        remoteIndexFailed = true
        remoteIndexFailureMessage = errorMessage(error)
        updateStatus({
          state: 'failed',
          lastFailure: remoteIndexFailureMessage,
          lastFailureAt: nowIso(),
        })
      })

      entries = await getAllOutboxEntries()
      syncScopePlan = getOpfsCloudSyncScopePlan(entries, scopedProjectPath)
    }

    for (const projectPath of syncScopePlan.projectPaths) {
      await syncProject(
        projectPath,
        outboxEntriesForProject(entries, projectPath)
      )
    }

    await refreshPendingCount()
    const syncedAt = pendingStatusSyncedAt
    if (opfsCloudSyncStatus.value.state !== 'conflict' && remoteIndexFailed) {
      updateStatus({
        state: 'failed',
        activeProjectPath: undefined,
        lastFailure: remoteIndexFailureMessage,
        lastFailureAt: nowIso(),
        ...(syncedAt ? { lastSyncedAt: syncedAt } : {}),
      })
      scheduleSync(SYNC_RETRY_MS)
    } else if (opfsCloudSyncStatus.value.state !== 'conflict') {
      updateStatus({
        state: 'idle',
        activeProjectPath: undefined,
        ...(syncedAt
          ? {
              lastSyncedAt: syncedAt,
              lastFailure: undefined,
              lastFailureAt: undefined,
            }
          : {}),
      })
    }
    if (
      opfsCloudSyncStatus.value.pendingCount > 0 &&
      opfsCloudSyncStatus.value.state !== 'conflict'
    ) {
      scheduleSync(SYNC_DEBOUNCE_MS)
    }
  } catch (error) {
    const syncedAt = pendingStatusSyncedAt
    updateStatus({
      state: 'failed',
      lastFailure: errorMessage(error),
      lastFailureAt: nowIso(),
      activeProjectPath: scopedProjectPath,
      ...(syncedAt ? { lastSyncedAt: syncedAt } : {}),
    })
    scheduleSync(SYNC_RETRY_MS)
  } finally {
    syncInProgress = false
    pendingStatusSyncedAt = undefined
    if (
      opfsCloudSyncStatus.value.pendingCount > 0 &&
      opfsCloudSyncStatus.value.state !== 'conflict'
    ) {
      scheduleSync(SYNC_DEBOUNCE_MS)
    }
  }
}

function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (!isConfiguredForCloud()) {
    return
  }
  if (syncTimer) {
    clearTimeout(syncTimer)
  }

  syncTimer = setTimeout(() => {
    syncTimer = undefined
    void runCloudSync()
  }, delay)
}

function scheduleRemoteIndexSync(delay = 0) {
  lastRemoteIndexSyncAt = 0
  scheduleSync(delay)
}

// Home syncs the full cloud index; file routes narrow status and retries to
// the open project so unrelated project conflicts do not pollute the editor UI.
export function setOpfsCloudSyncProjectScope(projectPath?: string) {
  const nextSyncScopeProjectPath = getSyncScopeProjectPath(projectPath)
  if (syncScopeProjectPath === nextSyncScopeProjectPath) {
    return
  }

  syncScopeProjectPath = nextSyncScopeProjectPath
  void refreshPendingCount()

  const statusProjectPath = opfsCloudSyncStatus.value.activeProjectPath
    ? normalizePathForSync(opfsCloudSyncStatus.value.activeProjectPath)
    : undefined
  if (
    nextSyncScopeProjectPath &&
    opfsCloudSyncStatus.value.state !== 'disabled' &&
    statusProjectPath !== nextSyncScopeProjectPath
  ) {
    updateStatus({
      state: 'idle',
      activeProjectPath: undefined,
      lastFailure: undefined,
      lastFailureAt: undefined,
    })
  }

  scheduleSync(0)
}

function attachVisibilityChangeListener() {
  if (
    detachVisibilityChangeListener ||
    typeof document === 'undefined' ||
    typeof document.addEventListener !== 'function'
  ) {
    return
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      scheduleRemoteIndexSync()
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  detachVisibilityChangeListener = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    detachVisibilityChangeListener = undefined
  }
}

async function registerProjectMutation(
  projectPath: string,
  kind: OutboxEntry['kind'],
  targetPath: string,
  sourcePath?: string
) {
  if (!isConfiguredForCloud() || isInternalOpfsPath(targetPath)) {
    return
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  let metadata = await getOrCreateProjectMetadata(normalizedProjectPath)
  metadata = await bindRemoteProjectIdFromToml(metadata)

  if (kind === 'delete') {
    metadata = {
      ...metadata,
      tombstone: true,
    }
    await putProjectMetadata(metadata)
  } else if (!metadata.tombstone) {
    await putProjectMetadata(metadata)
  }

  await appendOutboxEntry({
    projectPath: normalizedProjectPath,
    kind,
    targetPath: normalizePathForSync(targetPath),
    sourcePath: sourcePath ? normalizePathForSync(sourcePath) : undefined,
    createdAt: nowIso(),
  })
  scheduleSync()
}

async function registerProjectRename(sourcePath: string, targetPath: string) {
  if (!isConfiguredForCloud()) {
    return
  }

  const sourceProjectRoot = getOpfsCloudProjectRoot(sourcePath)
  const targetProjectRoot = getOpfsCloudProjectRoot(targetPath)
  if (!targetProjectRoot) {
    return
  }

  if (
    sourceProjectRoot &&
    isProjectRootPath(sourcePath, sourceProjectRoot) &&
    isProjectRootPath(targetPath, targetProjectRoot)
  ) {
    const sourceMetadata = await getProjectMetadata(sourceProjectRoot)
    if (sourceMetadata) {
      await clearOutboxEntriesForProject(sourceProjectRoot)
      await deleteProjectMetadata(sourceProjectRoot)
      await putProjectMetadata({
        ...sourceMetadata,
        localProjectPath: normalizePathForSync(targetProjectRoot),
        projectName: projectNameFromPath(targetProjectRoot),
        tombstone: false,
      })
    }
  }

  await registerProjectMutation(
    targetProjectRoot,
    'upsert',
    targetPath,
    sourcePath
  )
}

async function afterWriteLikeMutation(targetPath: string) {
  const projectRoot = getOpfsCloudProjectRoot(targetPath)
  if (!projectRoot) {
    if (isOpfsCloudProjectDirectoryPath(targetPath)) {
      scheduleSync()
    }
    return
  }

  await registerProjectMutation(projectRoot, 'upsert', targetPath)
}

async function afterRemoveMutation(targetPath: string) {
  const projectRoot = getOpfsCloudProjectRoot(targetPath)
  if (!projectRoot) {
    return
  }

  await registerProjectMutation(
    projectRoot,
    isProjectRootPath(targetPath, projectRoot) ? 'delete' : 'upsert',
    targetPath
  )
}

export function configureOpfsCloudSync(nextConfig: OPFSCloudConfig) {
  const previousConfig = config
  config = {
    ...config,
    ...nextConfig,
  }
  const cloudIdentityChanged =
    previousConfig.token !== config.token ||
    previousConfig.baseUrl !== config.baseUrl ||
    previousConfig.environmentName !== config.environmentName
  const projectDirectoryChanged =
    previousConfig.projectDirectoryPath !== config.projectDirectoryPath
  if (cloudIdentityChanged || projectDirectoryChanged) {
    lastRemoteIndexSyncAt = 0
    initialLocalScanComplete = false
  }

  if (!config.enabled) {
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = undefined
    }
    detachVisibilityChangeListener?.()
    initialLocalScanComplete = false
    lastRemoteIndexSyncAt = 0
    updateStatus({
      enabled: false,
      state: 'disabled',
      activeProjectPath: undefined,
    })
    return
  }

  attachVisibilityChangeListener()
  updateStatus({
    enabled: true,
    state: 'idle',
  })
  void refreshPendingCount()
  scheduleSync(0)
}

export function retryOpfsCloudSync() {
  if (syncScopeProjectPath) {
    scheduleSync(0)
    return
  }

  scheduleRemoteIndexSync()
}

type ReadFileOptions = undefined | 'utf8' | { encoding: 'utf-8' }

const readFile = (async (targetPath: string, options?: ReadFileOptions) => {
  const result = await localFs.readFile(targetPath, options)
  if (isConfiguredForCloud()) {
    const projectRoot = getOpfsCloudProjectRoot(targetPath)
    if (projectRoot || isOpfsCloudProjectDirectoryPath(targetPath)) {
      scheduleSync()
    }
  }
  return result
}) as IZooDesignStudioFS['readFile']

const readdir: IZooDesignStudioFS['readdir'] = async (targetPath, options) => {
  const result = await localFs.readdir(targetPath, options)
  if (isConfiguredForCloud()) {
    const projectRoot = getOpfsCloudProjectRoot(targetPath)
    if (projectRoot || isOpfsCloudProjectDirectoryPath(targetPath)) {
      scheduleSync()
    }
  }
  return result
}

const stat: IZooDesignStudioFS['stat'] = async (targetPath, options) => {
  const result = await localFs.stat(targetPath, options)
  if (isConfiguredForCloud()) {
    const projectRoot = getOpfsCloudProjectRoot(targetPath)
    if (projectRoot || isOpfsCloudProjectDirectoryPath(targetPath)) {
      scheduleSync()
    }
  }
  return result
}

const writeFile: IZooDesignStudioFS['writeFile'] = async (
  targetPath,
  data,
  options
) => {
  const result = await localFs.writeFile(targetPath, data, options)
  await afterWriteLikeMutation(targetPath).catch(markCloudMetadataFailure)
  return result
}

const mkdir: IZooDesignStudioFS['mkdir'] = async (targetPath, options) => {
  const result = await localFs.mkdir(targetPath, options)
  await afterWriteLikeMutation(targetPath).catch(markCloudMetadataFailure)
  return result
}

const cp: IZooDesignStudioFS['cp'] = async (
  sourcePath,
  targetPath,
  options
) => {
  const result = await localFs.cp(sourcePath, targetPath, options)
  await afterWriteLikeMutation(targetPath).catch(markCloudMetadataFailure)
  return result
}

const rm: IZooDesignStudioFS['rm'] = async (targetPath, options) => {
  const result = await localFs.rm(targetPath, options)
  await afterRemoveMutation(targetPath).catch(markCloudMetadataFailure)
  return result
}

const rename: IZooDesignStudioFS['rename'] = async (
  sourcePath,
  targetPath,
  options
) => {
  const result = await localFs.rename(sourcePath, targetPath, options)
  await registerProjectRename(sourcePath, targetPath).catch(
    markCloudMetadataFailure
  )
  return result
}

const impl: IZooDesignStudioFS = {
  resolve: localFs.resolve.bind(localFs),
  join: localFs.join.bind(localFs),
  relative: localFs.relative.bind(localFs),
  extname: localFs.extname.bind(localFs),
  sep: localFs.sep,
  basename: localFs.basename.bind(localFs),
  dirname: localFs.dirname.bind(localFs),
  getPath: localFs.getPath,
  access: localFs.access,
  cp,
  readFile,
  rename,
  writeFile,
  readdir,
  stat,
  mkdir,
  rm,
  detach: async () => {
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = undefined
    }
    syncInProgress = false
    await localFs.detach()
  },
  attach: async () => {
    await localFs.attach()
    if (isConfiguredForCloud()) {
      scheduleSync(0)
    }
  },
}

export default {
  impl,
}
