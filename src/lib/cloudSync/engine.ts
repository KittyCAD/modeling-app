import { signal } from '@preact/signals-core'
import env, { getEnvironmentNameFromEnv } from '@src/env'
import {
  CloudApiError,
  createRemoteProject,
  deleteRemoteProject,
  downloadRemoteProjectArchive,
  getRemoteProject,
  getRemoteProjectThumbnailUrl,
  listRemoteProjects,
  updateRemoteProject,
} from '@src/lib/cloudSync/cloudApi'
import {
  getCloudSyncProjectRoot,
  INTERNAL_OPFS_META_FILE,
  isCloudSyncProjectDirectoryPath,
  isProjectRootPath,
  normalizePathForSync,
  normalizeRelativePath,
} from '@src/lib/cloudSync/paths'
import {
  getRemoteProjectTitleForProjectToml,
  parseProjectArchive,
  projectManifestFromFiles,
  projectManifestsEqual,
  toArrayBuffer,
  withProjectTitleInArchiveFiles,
  withRemoteProjectMetadataInArchiveFiles,
} from '@src/lib/cloudSync/projectArchive'
import {
  appendOutboxEntry as appendSyncDbOutboxEntry,
  clearOutboxEntriesForProject as clearSyncDbOutboxEntriesForProject,
  deleteProjectMetadata,
  getAllOutboxEntries,
  getAllProjectMetadata,
  getProjectMetadata,
  putProjectMetadata,
  resetProjectSyncIdentity,
} from '@src/lib/cloudSync/syncDb'
import type {
  CloudSyncConfig,
  CloudSyncLocalProject,
  CloudSyncProjectMetadataIndexEntry,
  CloudSyncStatus,
  OutboxEntry,
  ProjectArchiveFile,
  ProjectManifest,
  ProjectMetadata,
  RemoteProject,
  RemoteProjectSummary,
  Revision,
} from '@src/lib/cloudSync/types'
import {
  DUPLICATE_IN_PROGRESS_FILE_NAME,
  PROJECT_FOLDER,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import {
  getDuplicateReservationFileName,
  parseDuplicateOwnershipEvidence,
} from '@src/lib/fs-zds/duplicateReservations'
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import opfs from '@src/lib/fs-zds/opfs'
import {
  appendGitignoreForDirectoryWithFs,
  createGitignoreStackFromFiles,
  createInitialGitignoreStackWithFs,
  type GitignoreStackEntry,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'
import { webSafePathSplit } from '@src/lib/pathUtils'
import { sanitizeProjectName } from '@src/lib/projectName'
import {
  getCloudProjectIdFromProjectTomlContents,
  getProjectTitleFromProjectTomlContents,
  removeCloudProjectIdFromProjectTomlContents,
  setCloudProjectIdInProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'

export { getCloudSyncProjectRoot } from '@src/lib/cloudSync/paths'
export {
  prepareProjectFilesForCloudUpload,
  projectManifestsEqual,
} from '@src/lib/cloudSync/projectArchive'
export {
  getCloudSyncProjectMetadata,
  getCloudSyncProjectMetadataIndex,
} from '@src/lib/cloudSync/syncDb'
export type {
  CloudSyncLocalProject,
  CloudSyncProjectMetadataIndexEntry,
  CloudSyncState,
  CloudSyncStatus,
  OutboxEntry,
  ProjectArchiveFile,
  ProjectManifest,
  ProjectMetadata,
  RemoteProjectSummary,
} from '@src/lib/cloudSync/types'

export type CloudSyncConflictResolution = 'local' | 'cloud'

const SYNC_DEBOUNCE_MS = 2500
const SYNC_RETRY_MS = 30_000
const REMOTE_INDEX_INTERVAL_MS = 5 * 60 * 1000

let localFs: IZooDesignStudioFS = opfs.impl

let config: CloudSyncConfig = {
  enabled: false,
}
let syncTimer: ReturnType<typeof setTimeout> | undefined
let syncInProgress = false
let lastRemoteIndexSyncAt = 0
let initialLocalScanComplete = false
let conflictCopyRepairComplete = false
let pendingStatusSyncedAt: string | undefined
let detachVisibilityChangeListener: (() => void) | undefined
let syncScopeProjectPath: string | undefined
let activeCloudSyncRunCompletion: Promise<void> | undefined

type ProjectMutationSuppression = {
  count: number
  acceptingTransactions: boolean
  commitRequested: boolean
  freshProjectIdentityRequested: boolean
  freshProjectIdentityResetFailed: boolean
  afterFreshIdentityResetCallbacks: Array<() => Promise<void>>
  webLockReady: Promise<void>
  resolveWebLockReady: () => void
  transactionsComplete: Promise<void>
  resolveTransactionsComplete: () => void
}

const suppressedProjectMutations = new Map<string, ProjectMutationSuppression>()
type ProjectReadLease = {
  count: number
  webLockReady: Promise<void>
  resolveWebLockReady: () => void
  readsComplete: Promise<void>
  resolveReadsComplete: () => void
}

const activeProjectReadLeases = new Map<string, ProjectReadLease>()
const localProjectLockTails = new Map<string, Promise<void>>()
const quarantinedPartialProjectPaths = new Set<string>()

export const cloudSyncStatus = signal<CloudSyncStatus>({
  enabled: false,
  state: 'disabled',
  pendingCount: 0,
})
export const cloudSyncRemoteProjects = signal<RemoteProjectSummary[]>([])

function updateStatus(next: Partial<CloudSyncStatus>) {
  cloudSyncStatus.value = {
    ...cloudSyncStatus.value,
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

function getConfiguredProjectRoot(targetPath: string) {
  const normalizedTargetPath = normalizePathForSync(targetPath)
  const projectDirectory = getConfiguredProjectDirectoryPath()
  if (normalizedTargetPath === projectDirectory) {
    return undefined
  }

  const relativePath = normalizeRelativePath(
    localFs.relative(projectDirectory, normalizedTargetPath)
  )
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../')
  ) {
    return getCloudSyncProjectRoot(targetPath)
  }

  const [projectName] = webSafePathSplit(relativePath).filter(Boolean)
  return projectName
    ? normalizePathForSync(localFs.join(projectDirectory, projectName))
    : undefined
}

function isConfiguredProjectDirectoryPath(targetPath: string) {
  return (
    normalizePathForSync(targetPath) === getConfiguredProjectDirectoryPath() ||
    isCloudSyncProjectDirectoryPath(targetPath)
  )
}

function projectNameFromPath(projectPath: string) {
  return localFs.basename(normalizePathForSync(projectPath))
}

function isProjectMutationSuppressed(projectPath: string) {
  return suppressedProjectMutations.has(normalizePathForSync(projectPath))
}

function isProjectReadLeased(projectPath: string) {
  return activeProjectReadLeases.has(normalizePathForSync(projectPath))
}

function isProjectCloudOperationDeferred(projectPath: string) {
  return (
    isProjectMutationSuppressed(projectPath) || isProjectReadLeased(projectPath)
  )
}

function isPathNotFoundError(error: unknown) {
  if (error === 'ENOENT') {
    return true
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

async function readDuplicateOwnershipEvidence(evidencePath: string) {
  try {
    return parseDuplicateOwnershipEvidence(
      await localFs.readFile(evidencePath, { encoding: 'utf-8' })
    )
  } catch {
    return undefined
  }
}

async function hasDuplicateInProgressMarker(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const markerPath = localFs.join(
    normalizedProjectPath,
    DUPLICATE_IN_PROGRESS_FILE_NAME
  )
  const evidence = await readDuplicateOwnershipEvidence(markerPath)
  return evidence?.kind === 'target'
}

async function hasDuplicateTargetReservation(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const targetName = projectNameFromPath(normalizedProjectPath)
  const reservationPath = localFs.join(
    localFs.dirname(normalizedProjectPath),
    getDuplicateReservationFileName(targetName)
  )
  const evidence = await readDuplicateOwnershipEvidence(reservationPath)
  return (
    evidence?.kind === 'reservation' &&
    evidence.targetName.normalize('NFC').toLowerCase().normalize('NFC') ===
      targetName.normalize('NFC').toLowerCase().normalize('NFC')
  )
}

async function isPartialProjectQuarantined(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  if (
    (await hasDuplicateInProgressMarker(normalizedProjectPath)) ||
    (await hasDuplicateTargetReservation(normalizedProjectPath))
  ) {
    quarantinedPartialProjectPaths.add(normalizedProjectPath)
    return true
  }

  try {
    await localFs.stat(normalizedProjectPath)
  } catch (error) {
    if (isPathNotFoundError(error)) {
      quarantinedPartialProjectPaths.delete(normalizedProjectPath)
      return false
    }
  }

  // Re-read ownership evidence after checking the root. This closes the
  // reservation/marker creation window for callers not protected by a lock.
  const evidenceAppeared =
    (await hasDuplicateInProgressMarker(normalizedProjectPath)) ||
    (await hasDuplicateTargetReservation(normalizedProjectPath))
  if (evidenceAppeared) {
    quarantinedPartialProjectPaths.add(normalizedProjectPath)
    return true
  }

  quarantinedPartialProjectPaths.delete(normalizedProjectPath)
  return false
}

function projectWriteTransactionActiveError(projectPath: string) {
  return new Error(
    `Cloud project operation cannot run while ${normalizePathForSync(projectPath)} is being changed.`
  )
}

async function requireCloudProjectOperationReady(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  if (isProjectMutationSuppressed(normalizedProjectPath)) {
    return Promise.reject(
      projectWriteTransactionActiveError(normalizedProjectPath)
    )
  }
  if (await isPartialProjectQuarantined(normalizedProjectPath)) {
    return Promise.reject(
      new Error(
        `Cloud project operation cannot run while ${normalizedProjectPath} is being published.`
      )
    )
  }
}

function hasCloudSyncProjectLocks() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.locks?.request === 'function'
  )
}

async function withCloudSyncProjectLock<T>(
  projectPath: string,
  operation: () => Promise<T>
) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const lockManager =
    typeof navigator === 'undefined' ? undefined : navigator.locks
  if (typeof lockManager?.request !== 'function') {
    return withLocalCloudSyncProjectLock(normalizedProjectPath, operation)
  }

  let lockAcquired = false
  try {
    return await lockManager.request(
      `zds-cloud-sync:${normalizedProjectPath}`,
      async () => {
        lockAcquired = true
        return operation()
      }
    )
  } catch (error) {
    if (lockAcquired) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw error
    }
    // A partial Web Locks implementation must not strand the local fallback.
    return withLocalCloudSyncProjectLock(normalizedProjectPath, operation)
  }
}

async function withLocalCloudSyncProjectLock<T>(
  projectPath: string,
  operation: () => Promise<T>
) {
  const previous = localProjectLockTails.get(projectPath) ?? Promise.resolve()
  const current = createVoidDeferred()
  localProjectLockTails.set(projectPath, current.promise)
  await previous
  try {
    return await operation()
  } finally {
    current.resolve()
    if (localProjectLockTails.get(projectPath) === current.promise) {
      localProjectLockTails.delete(projectPath)
    }
  }
}

async function withCloudSyncProjectLocks<T>(
  projectPaths: string[],
  operation: () => Promise<T>
) {
  const orderedProjectPaths = [
    ...new Set(projectPaths.map(normalizePathForSync)),
  ].toSorted()
  const acquire = (index: number): Promise<T> => {
    const projectPath = orderedProjectPaths[index]
    if (!projectPath) {
      return operation()
    }
    return withCloudSyncProjectLock(projectPath, () => acquire(index + 1))
  }
  return acquire(0)
}

function createVoidDeferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function suppressProjectMutations(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const existing = suppressedProjectMutations.get(normalizedProjectPath)
  if (existing?.acceptingTransactions) {
    existing.count += 1
    return {
      isOutermostTransaction: false,
      normalizedProjectPath,
      suppression: existing,
    }
  }

  const webLockReady = createVoidDeferred()
  const transactionsComplete = createVoidDeferred()
  const suppression: ProjectMutationSuppression = {
    count: 1,
    acceptingTransactions: true,
    commitRequested: false,
    freshProjectIdentityRequested: false,
    freshProjectIdentityResetFailed: false,
    afterFreshIdentityResetCallbacks: [],
    webLockReady: webLockReady.promise,
    resolveWebLockReady: webLockReady.resolve,
    transactionsComplete: transactionsComplete.promise,
    resolveTransactionsComplete: transactionsComplete.resolve,
  }
  suppressedProjectMutations.set(normalizedProjectPath, suppression)
  return {
    isOutermostTransaction: true,
    normalizedProjectPath,
    suppression,
  }
}

function resumeProjectMutations(suppression: ProjectMutationSuppression) {
  suppression.count -= 1
  if (suppression.count > 0) {
    return false
  }

  // Close this cohort before waking the outer transaction. A transaction
  // started after every current operation has completed must queue behind the
  // final identity reset/registration instead of joining a settled promise.
  suppression.acceptingTransactions = false
  suppression.resolveTransactionsComplete()
  return true
}

function releaseProjectMutationSuppression(
  projectPath: string,
  suppression: ProjectMutationSuppression
) {
  if (suppressedProjectMutations.get(projectPath) === suppression) {
    suppressedProjectMutations.delete(projectPath)
  }
}

function leaseProjectForRead(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const existing = activeProjectReadLeases.get(normalizedProjectPath)
  if (existing) {
    existing.count += 1
    return {
      isOutermostRead: false,
      normalizedProjectPath,
      lease: existing,
    }
  }

  const webLockReady = createVoidDeferred()
  const readsComplete = createVoidDeferred()
  const lease: ProjectReadLease = {
    count: 1,
    webLockReady: webLockReady.promise,
    resolveWebLockReady: webLockReady.resolve,
    readsComplete: readsComplete.promise,
    resolveReadsComplete: readsComplete.resolve,
  }
  activeProjectReadLeases.set(normalizedProjectPath, lease)
  return {
    isOutermostRead: true,
    normalizedProjectPath,
    lease,
  }
}

function finishProjectRead(projectPath: string, lease: ProjectReadLease) {
  lease.count -= 1
  if (lease.count === 0) {
    // Stop admitting new readers before resolving the cohort. Otherwise a
    // reader can join after this promise has settled but before the outer
    // callback releases the project lock, and then outlive that lock.
    releaseProjectReadLease(projectPath, lease)
    lease.resolveReadsComplete()
  }
}

function releaseProjectReadLease(projectPath: string, lease: ProjectReadLease) {
  if (activeProjectReadLeases.get(projectPath) === lease) {
    activeProjectReadLeases.delete(projectPath)
  }
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

function isProjectSyncExcluded(metadata: ProjectMetadata | undefined) {
  return Boolean(metadata?.syncExcluded)
}

export function shouldCloudSyncAutoSyncLocalProject({
  syncExistingLocalProjects,
  hasRemoteProjectId,
  hasBaseManifest,
}: {
  syncExistingLocalProjects: boolean | undefined
  hasRemoteProjectId: boolean
  hasBaseManifest: boolean
}) {
  return (
    syncExistingLocalProjects !== false || hasRemoteProjectId || hasBaseManifest
  )
}

function shouldAutoSyncLocalProject(metadata: ProjectMetadata) {
  return shouldCloudSyncAutoSyncLocalProject({
    syncExistingLocalProjects: config.syncExistingLocalProjects,
    hasRemoteProjectId: Boolean(metadata.remoteProjectId),
    hasBaseManifest: Boolean(metadata.baseManifest),
  })
}

const CLOUD_CONFLICT_PROJECT_NAME_PATTERN = /\s+\(cloud conflict \d{8}T\d{6}\)/g

export function isCloudSyncConflictCopyProjectName(projectName: string) {
  return Boolean(projectName.match(CLOUD_CONFLICT_PROJECT_NAME_PATTERN))
}

function getCloudConflictMarkerCount(projectName: string) {
  return projectName.match(CLOUD_CONFLICT_PROJECT_NAME_PATTERN)?.length ?? 0
}

function getCloudConflictSourceProjectName(projectName: string) {
  return projectName.replace(CLOUD_CONFLICT_PROJECT_NAME_PATTERN, '').trim()
}

function getProjectManifestKey(manifest: ProjectManifest) {
  return JSON.stringify(
    Object.entries(manifest.files).toSorted(([left], [right]) =>
      left.localeCompare(right)
    )
  )
}

export type CloudSyncConflictCopyCleanupCandidate = {
  projectPath: string
  projectName: string
  remoteProjectId?: string
  manifest?: ProjectManifest
}

export type CloudSyncConflictCopyCleanupPlan = {
  excludeProjectPaths: string[]
  deleteProjectPaths: string[]
}

export function getCloudSyncConflictCopyCleanupPlan(
  candidates: CloudSyncConflictCopyCleanupCandidate[]
): CloudSyncConflictCopyCleanupPlan {
  const conflictCopies = candidates
    .filter((candidate) =>
      isCloudSyncConflictCopyProjectName(candidate.projectName)
    )
    .map((candidate) => ({
      ...candidate,
      projectPath: normalizePathForSync(candidate.projectPath),
    }))
  const excludeProjectPaths = conflictCopies.map(
    (conflictCopy) => conflictCopy.projectPath
  )
  const deleteProjectPaths: string[] = []
  const conflictCopiesByRemoteProjectId = new Map<
    string,
    CloudSyncConflictCopyCleanupCandidate[]
  >()
  for (const conflictCopy of conflictCopies) {
    if (!conflictCopy.remoteProjectId || !conflictCopy.manifest) {
      continue
    }
    conflictCopiesByRemoteProjectId.set(conflictCopy.remoteProjectId, [
      ...(conflictCopiesByRemoteProjectId.get(conflictCopy.remoteProjectId) ??
        []),
      conflictCopy,
    ])
  }

  for (const remoteProjectConflictCopies of conflictCopiesByRemoteProjectId.values()) {
    const keptManifestKeys = new Set<string>()
    for (const conflictCopy of remoteProjectConflictCopies.toSorted(
      (left, right) => {
        const markerCountDelta =
          getCloudConflictMarkerCount(left.projectName) -
          getCloudConflictMarkerCount(right.projectName)
        return (
          markerCountDelta || left.projectPath.localeCompare(right.projectPath)
        )
      }
    )) {
      const manifest = conflictCopy.manifest
      if (!manifest) {
        continue
      }

      const manifestKey = getProjectManifestKey(manifest)
      if (keptManifestKeys.has(manifestKey)) {
        deleteProjectPaths.push(conflictCopy.projectPath)
        continue
      }
      keptManifestKeys.add(manifestKey)
    }
  }

  return {
    excludeProjectPaths,
    deleteProjectPaths,
  }
}

export function filterCloudSyncProjectFilesForSync(
  files: ProjectArchiveFile[]
) {
  const normalizedFiles = files.map((file) => ({
    ...file,
    relativePath: normalizeRelativePath(file.relativePath),
  }))
  const gitignoreStack = createGitignoreStackFromFiles(
    normalizedFiles
      .filter((file) => projectNameFromPath(file.relativePath) === '.gitignore')
      .map((file) => ({
        relativePath: file.relativePath,
        contents: new TextDecoder().decode(file.data),
      }))
  )

  return normalizedFiles.filter(
    (file) =>
      !isPathIgnoredByGitignore(gitignoreStack, file.relativePath, false)
  )
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

export type CloudSyncScopePlan = {
  shouldSyncRemoteIndex: boolean
  projectPaths: string[]
  pendingCount: number
}

export function getCloudSyncScopePlan(
  entries: OutboxEntry[],
  scopeProjectPath?: string
): CloudSyncScopePlan {
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

  return getEnvironmentNameFromEnv(env())
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

export function getCloudSyncProjectModifiedTime(
  metadata: CloudSyncProjectMetadataIndexEntry | undefined,
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

export type CloudSyncInitialLocalProjectSyncAction = 'skip' | 'enqueue'

export function getCloudSyncInitialLocalProjectSyncAction({
  hasBaseManifest,
  tombstone,
  syncExcluded,
}: {
  hasBaseManifest: boolean
  tombstone: boolean
  syncExcluded: boolean
}): CloudSyncInitialLocalProjectSyncAction {
  if (syncExcluded || (hasBaseManifest && !tombstone)) {
    return 'skip'
  }

  return 'enqueue'
}

export type CloudSyncMissingRemoteProjectAction =
  | 'forget-missing-local'
  | 'remove-clean-local'
  | 'detach-dirty-local'

export function getCloudSyncMissingRemoteProjectAction({
  localProjectExists,
  hasPendingLocalChanges,
  hasBaseManifest,
  localMatchesBase,
}: {
  localProjectExists: boolean
  hasPendingLocalChanges: boolean
  hasBaseManifest: boolean
  localMatchesBase: boolean
}): CloudSyncMissingRemoteProjectAction {
  if (!localProjectExists) {
    return 'forget-missing-local'
  }
  if (hasBaseManifest && localMatchesBase && !hasPendingLocalChanges) {
    return 'remove-clean-local'
  }

  return 'detach-dirty-local'
}

async function writeLocalProjectTitle(projectPath: string, title: string) {
  return updateLocalProjectToml(projectPath, (projectToml) =>
    getProjectTitleFromProjectTomlContents(projectToml) === title
      ? projectToml
      : setProjectTitleInProjectTomlContents(projectToml, title)
  )
}

async function ensureLocalProjectTitle(projectPath: string, title?: string) {
  if (!title?.trim()) {
    return false
  }

  return updateLocalProjectToml(projectPath, (projectToml) =>
    getProjectTitleFromProjectTomlContents(projectToml)
      ? projectToml
      : setProjectTitleInProjectTomlContents(projectToml, title)
  )
}

async function readLocalProjectTitle(projectPath: string) {
  const projectTomlPath = localFs.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  if (!(await exists(projectTomlPath))) {
    return undefined
  }

  return getProjectTitleFromProjectTomlContents(
    await localFs.readFile(projectTomlPath, { encoding: 'utf-8' })
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

async function removeLocalProjectCloudProjectId(projectPath: string) {
  const environmentName = getEnvironmentName()
  if (!environmentName) {
    return false
  }

  return updateLocalProjectToml(projectPath, (projectToml) =>
    removeCloudProjectIdFromProjectTomlContents(projectToml, environmentName)
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
    const visibleEntries = entries.filter(
      (entry) =>
        !quarantinedPartialProjectPaths.has(
          normalizePathForSync(entry.projectPath)
        )
    )
    updateStatus({
      pendingCount: getCloudSyncScopePlan(visibleEntries, syncScopeProjectPath)
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

  const walk = async (
    currentPath: string,
    gitignoreStack: GitignoreStackEntry[]
  ) => {
    const entries = await localFs.readdir(currentPath)
    for (const entry of entries) {
      if (entry === INTERNAL_OPFS_META_FILE) {
        continue
      }

      const absolutePath = localFs.join(currentPath, entry)
      const stat = await localFs.stat(absolutePath)
      const relativePath = normalizeRelativePath(
        localFs.relative(projectRoot, absolutePath)
      )
      const isDirectory = statIsDirectory(stat)
      if (isPathIgnoredByGitignore(gitignoreStack, relativePath, isDirectory)) {
        continue
      }

      if (statIsDirectory(stat)) {
        const childGitignoreStack = await appendGitignoreForDirectoryWithFs(
          localFs,
          gitignoreStack,
          absolutePath,
          projectRoot
        )
        await walk(absolutePath, childGitignoreStack)
        continue
      }

      const data = await localFs.readFile(absolutePath)
      files.push({
        relativePath,
        data: Uint8Array.from(data),
      })
    }
  }

  const gitignoreStack = await createInitialGitignoreStackWithFs(
    localFs,
    projectRoot
  )
  await walk(projectRoot, gitignoreStack)
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
  projectName: string,
  rejectedProjectPaths = new Set<string>()
) {
  let candidate = localFs.join(projectDirectory, projectName)
  if (
    !rejectedProjectPaths.has(normalizePathForSync(candidate)) &&
    !(await exists(candidate))
  ) {
    return candidate
  }

  let index = 2
  while (
    rejectedProjectPaths.has(normalizePathForSync(candidate)) ||
    (await exists(candidate))
  ) {
    candidate = localFs.join(projectDirectory, `${projectName} ${index}`)
    index += 1
  }
  return candidate
}

function localProjectFromMetadata(
  metadata: ProjectMetadata
): CloudSyncLocalProject | undefined {
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
    if (isProjectMutationSuppressed(candidatePath)) {
      continue
    }
    if (await isPartialProjectQuarantined(candidatePath)) {
      continue
    }
    if (!(await exists(candidatePath))) {
      continue
    }
    const candidateMetadata = await getProjectMetadata(candidatePath)
    if (isProjectSyncExcluded(candidateMetadata)) {
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
): Promise<CloudSyncLocalProject> {
  await localFs.mkdir(projectDirectory, { recursive: true })
  const projectName = localProjectNameForRemoteProject(remoteProject)
  const archive = await downloadRemoteProjectArchive(config, remoteProject.id)
  const files = filterCloudSyncProjectFilesForSync(
    withRemoteProjectMetadataInArchiveFiles(
      await parseProjectArchive(archive),
      remoteProject.title,
      remoteProject.id,
      getEnvironmentName()
    )
  )
  const manifest = await projectManifestFromFiles(files)
  const rejectedProjectPaths = new Set<string>()
  let nextPreferredProjectPath = preferredProjectPath

  while (true) {
    const projectPath =
      nextPreferredProjectPath && !(await exists(nextPreferredProjectPath))
        ? nextPreferredProjectPath
        : await uniqueProjectPath(
            projectDirectory,
            projectName,
            rejectedProjectPaths
          )
    const normalizedProjectPath = normalizePathForSync(projectPath)
    if (isProjectMutationSuppressed(normalizedProjectPath)) {
      return Promise.reject(
        projectWriteTransactionActiveError(normalizedProjectPath)
      )
    }

    const clonedProject = await withCloudSyncProjectLock(
      normalizedProjectPath,
      async () => {
        if (isProjectMutationSuppressed(normalizedProjectPath)) {
          return Promise.reject(
            projectWriteTransactionActiveError(normalizedProjectPath)
          )
        }
        if (
          (await isPartialProjectQuarantined(normalizedProjectPath)) ||
          (await exists(normalizedProjectPath))
        ) {
          return undefined
        }

        const nextMetadata = {
          ...metadataForProject(normalizedProjectPath),
          remoteProjectId: remoteProject.id,
        }
        await replaceLocalProjectWithFiles(normalizedProjectPath, files)
        await markProjectSynced(
          nextMetadata,
          manifest,
          remoteSyncMetadata(remoteProject)
        )

        return {
          projectPath: normalizedProjectPath,
          projectName: projectNameFromPath(normalizedProjectPath),
          remoteProjectId: remoteProject.id,
          remoteRevision: getRevision(remoteProject),
        }
      }
    )
    if (clonedProject) {
      return clonedProject
    }

    rejectedProjectPaths.add(normalizedProjectPath)
    nextPreferredProjectPath = undefined
  }
}

export async function ensureCloudProjectLocallySynced(
  remoteProjectId: string
): Promise<CloudSyncLocalProject | undefined> {
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
  if (knownLocalMetadata) {
    const knownMetadataPath = normalizePathForSync(
      knownLocalMetadata.localProjectPath
    )
    if (isProjectMutationSuppressed(knownMetadataPath)) {
      return Promise.reject(
        projectWriteTransactionActiveError(knownMetadataPath)
      )
    }

    let knownLocalProject: CloudSyncLocalProject | undefined
    let knownProjectHandled = false
    await withCloudSyncProjectLock(knownMetadataPath, async () => {
      await requireCloudProjectOperationReady(knownMetadataPath)
      const currentMetadata = await getProjectMetadata(knownMetadataPath)
      if (
        currentMetadata?.remoteProjectId !== projectId ||
        currentMetadata.tombstone
      ) {
        return
      }

      const currentProjectPath = projectPathInDirectory(
        currentMetadata,
        projectDirectory
      )
      if (!currentProjectPath || !(await exists(currentProjectPath))) {
        await deleteProjectMetadata(knownMetadataPath)
        return
      }

      knownProjectHandled = true
      let nextMetadata = currentMetadata
      if (!(await readLocalProjectTitle(currentProjectPath))) {
        const remoteProject = await getRemoteProject(config, projectId)
        nextMetadata = await hydrateCleanLocalProjectTitle(
          currentMetadata,
          getRemoteProjectTitleForProjectToml(remoteProject.title)
        )
      }
      knownLocalProject = localProjectFromMetadata(nextMetadata)
      if (nextMetadata !== currentMetadata) {
        scheduleSync(0)
      }
    })
    if (knownProjectHandled) {
      scheduleSync(0)
      return knownLocalProject
    }
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
    if (isProjectMutationSuppressed(existingProjectPath)) {
      return Promise.reject(
        projectWriteTransactionActiveError(existingProjectPath)
      )
    }
    const adoptedProject = await withCloudSyncProjectLock(
      existingProjectPath,
      async () => {
        await requireCloudProjectOperationReady(existingProjectPath)
        const currentProjectId = await readProjectTomlCloudProjectId(
          existingProjectPath
        ).catch(() => undefined)
        if (currentProjectId !== projectId) {
          return undefined
        }

        const nextMetadata = {
          ...(await getOrCreateProjectMetadata(existingProjectPath)),
          remoteProjectId: projectId,
          tombstone: false,
        }
        await ensureLocalProjectTitle(
          existingProjectPath,
          getRemoteProjectTitleForProjectToml(remoteProject.title)
        )
        await putProjectMetadata(nextMetadata)
        return localProjectFromMetadata(nextMetadata)
      }
    )
    if (adoptedProject) {
      scheduleSync(0)
      return adoptedProject
    }
  }

  return cloneRemoteProjectToLocal(
    remoteProject,
    projectDirectory,
    knownLocalProjectPath
  )
}

export async function getCloudSyncRemoteProjectThumbnailUrl(
  remoteProject: RemoteProjectSummary
) {
  if (!isConfiguredForCloud()) {
    return undefined
  }

  return getRemoteProjectThumbnailUrl(config, remoteProject)
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

async function readConflictCopyCleanupCandidate(
  projectPath: string,
  projectName: string
): Promise<CloudSyncConflictCopyCleanupCandidate | undefined> {
  if (
    isProjectCloudOperationDeferred(projectPath) ||
    (await isPartialProjectQuarantined(projectPath))
  ) {
    return undefined
  }
  const stat = await localFs.stat(projectPath).catch(() => undefined)
  if (!stat || !statIsDirectory(stat)) {
    return undefined
  }

  const remoteProjectId = await readProjectTomlCloudProjectId(
    projectPath
  ).catch(() => undefined)
  const manifest = await collectLocalProjectFiles(projectPath)
    .then(projectManifestFromFiles)
    .catch(() => undefined)
  return {
    projectPath,
    projectName,
    remoteProjectId,
    manifest,
  }
}

async function conflictCopyCandidateIsCurrent(
  candidate: CloudSyncConflictCopyCleanupCandidate
) {
  if (!candidate.manifest) {
    return false
  }
  const currentCandidate = await readConflictCopyCleanupCandidate(
    candidate.projectPath,
    candidate.projectName
  )
  return Boolean(
    currentCandidate?.manifest &&
      currentCandidate.remoteProjectId === candidate.remoteProjectId &&
      projectManifestsEqual(currentCandidate.manifest, candidate.manifest)
  )
}

async function repairExistingConflictCopies() {
  if (conflictCopyRepairComplete) {
    return
  }

  const projectDirectory = getConfiguredProjectDirectoryPath()
  if (!(await exists(projectDirectory))) {
    conflictCopyRepairComplete = true
    return
  }

  const entries = await localFs.readdir(projectDirectory)
  const candidates: CloudSyncConflictCopyCleanupCandidate[] = []
  for (const entry of entries) {
    if (entry.startsWith('.') || !isCloudSyncConflictCopyProjectName(entry)) {
      continue
    }

    const projectPath = localFs.join(projectDirectory, entry)
    await withCloudSyncProjectLock(projectPath, async () => {
      const candidate = await readConflictCopyCleanupCandidate(
        projectPath,
        entry
      )
      if (candidate) {
        candidates.push(candidate)
      }
    })
  }

  const cleanupPlan = getCloudSyncConflictCopyCleanupPlan(candidates)
  const candidatesByPath = new Map(
    candidates.map((candidate) => [
      normalizePathForSync(candidate.projectPath),
      candidate,
    ])
  )
  const deleteProjectPaths = new Set(cleanupPlan.deleteProjectPaths)
  const createdAt = nowIso()

  for (const projectPath of cleanupPlan.excludeProjectPaths) {
    if (deleteProjectPaths.has(projectPath)) {
      continue
    }

    await withCloudSyncProjectLock(projectPath, async () => {
      const candidate = candidatesByPath.get(projectPath)
      if (!candidate || !(await conflictCopyCandidateIsCurrent(candidate))) {
        return
      }
      const metadata = await getOrCreateProjectMetadata(projectPath)
      const remoteProjectId =
        candidate.remoteProjectId ?? metadata.remoteProjectId
      const sourceProjectName = getCloudConflictSourceProjectName(
        candidate.projectName
      )
      await clearOutboxEntriesForProject(projectPath)
      await putProjectMetadata({
        ...metadata,
        remoteProjectId,
        tombstone: false,
        syncExcluded: {
          reason: 'conflict-copy',
          sourceProjectPath:
            sourceProjectName && candidate.projectName !== sourceProjectName
              ? localFs.join(projectDirectory, sourceProjectName)
              : undefined,
          remoteProjectId,
          createdAt: metadata.syncExcluded?.createdAt ?? createdAt,
        },
      })
    })
  }

  for (const projectPath of cleanupPlan.deleteProjectPaths) {
    await withCloudSyncProjectLock(projectPath, async () => {
      const candidate = candidatesByPath.get(projectPath)
      if (!candidate || !(await conflictCopyCandidateIsCurrent(candidate))) {
        return
      }
      await clearOutboxEntriesForProject(projectPath)
      if (await exists(projectPath)) {
        await localFs.rm(projectPath, { recursive: true })
      }
      await deleteProjectMetadata(projectPath)
    })
  }

  conflictCopyRepairComplete = true
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
  if (metadata.remoteProjectId || isProjectSyncExcluded(metadata)) {
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

async function deleteConflictCopy(conflictProjectPath: string) {
  await clearOutboxEntriesForProject(conflictProjectPath)
  await deleteProjectMetadata(conflictProjectPath)
  if (await exists(conflictProjectPath)) {
    await localFs.rm(conflictProjectPath, { recursive: true })
  }
}

async function applyCloudDataForConflict(metadata: ProjectMetadata) {
  const conflict = metadata.conflict
  if (!conflict) {
    return
  }

  const remoteFiles = await collectLocalProjectFiles(
    conflict.conflictProjectPath
  )
  const remoteManifest = await projectManifestFromFiles(remoteFiles)
  await replaceLocalProjectWithFiles(metadata.localProjectPath, remoteFiles)
  await clearOutboxEntriesForProject(metadata.localProjectPath)
  await deleteConflictCopy(conflict.conflictProjectPath)
  await markProjectSynced(metadata, remoteManifest, {
    revision: conflict.remoteRevision,
  })
}

async function applyLocalDataForConflict(metadata: ProjectMetadata) {
  const conflict = metadata.conflict
  if (!metadata.remoteProjectId || !conflict) {
    return Promise.reject(
      new Error('Cloud conflict cannot be resolved without a remote project.')
    )
  }

  const localFiles = await collectLocalProjectFiles(metadata.localProjectPath)
  const localManifest = await projectManifestFromFiles(localFiles)
  const updated = await updateRemoteProject({
    config,
    projectPath: metadata.localProjectPath,
    projectId: metadata.remoteProjectId,
    files: localFiles,
    expectedRevision: conflict.remoteRevision ?? metadata.remoteRevision,
  })
  await clearOutboxEntriesForProject(metadata.localProjectPath)
  await deleteConflictCopy(conflict.conflictProjectPath)
  await markProjectSynced(
    metadata,
    localManifest,
    remoteSyncMetadata(updated, { useNowAsUpdatedAtFallback: true })
  )
}

export async function resolveCloudSyncProjectConflict(
  projectPath: string,
  resolution: CloudSyncConflictResolution
) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  if (isProjectMutationSuppressed(normalizedProjectPath)) {
    return Promise.reject(
      projectWriteTransactionActiveError(normalizedProjectPath)
    )
  }

  await withCloudSyncProjectLock(normalizedProjectPath, async () => {
    await requireCloudProjectOperationReady(normalizedProjectPath)
    const metadata = await getProjectMetadata(normalizedProjectPath)
    if (!metadata?.conflict) {
      return
    }

    try {
      if (resolution === 'cloud') {
        await applyCloudDataForConflict(metadata)
      } else {
        await applyLocalDataForConflict(metadata)
      }
      await refreshPendingCount()
      scheduleSync(0)
    } catch (error) {
      await markProjectFailure(metadata, error)
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw error
    }
  })
}

async function hydrateCleanLocalProjectTitle(
  metadata: ProjectMetadata,
  remoteTitle?: string
) {
  if (!(await exists(metadata.localProjectPath))) {
    return metadata
  }
  const projectTitle = getRemoteProjectTitleForProjectToml(remoteTitle)

  const existingProjectTitle = await readLocalProjectTitle(
    metadata.localProjectPath
  )
  if (existingProjectTitle === projectTitle) {
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
    projectTitle
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
  const createdAt = nowIso()
  const existingConflict = metadata.conflict
  const existingConflictProjectPath = existingConflict?.conflictProjectPath
  if (
    existingConflictProjectPath &&
    (await exists(existingConflictProjectPath))
  ) {
    await putProjectMetadata({
      ...metadata,
      conflict: {
        ...existingConflict,
        remoteRevision,
        conflictProjectPath: existingConflictProjectPath,
        createdAt: existingConflict.createdAt,
      },
      lastFailure: {
        message: 'Cloud sync conflict: local and remote both changed.',
        at: createdAt,
      },
    })
    updateStatus({
      state: 'conflict',
      activeProjectPath: metadata.localProjectPath,
      lastFailure: 'Cloud sync conflict: local and remote both changed.',
      lastFailureAt: createdAt,
    })
    return
  }

  const parentDirectory = localFs.dirname(metadata.localProjectPath)
  const stamp = createdAt.replace(/[-:]/g, '').slice(0, 15)
  const conflictName = `${metadata.projectName} (cloud conflict ${stamp})`
  const conflictProjectPath = await uniqueProjectPath(
    parentDirectory,
    conflictName
  )

  await replaceLocalProjectWithFiles(
    conflictProjectPath,
    withProjectTitleInArchiveFiles(
      remoteFiles,
      getRemoteProjectTitleForProjectToml(remoteTitle)
    )
  )

  await putProjectMetadata({
    ...metadataForProject(conflictProjectPath),
    remoteProjectId: metadata.remoteProjectId,
    remoteRevision,
    syncExcluded: {
      reason: 'conflict-copy',
      sourceProjectPath: metadata.localProjectPath,
      remoteProjectId: metadata.remoteProjectId,
      createdAt,
    },
  })
  await putProjectMetadata({
    ...metadata,
    conflict: {
      remoteRevision,
      conflictProjectPath,
      createdAt,
    },
    lastFailure: {
      message: 'Cloud sync conflict: local and remote both changed.',
      at: createdAt,
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

export type CloudSyncProjectSyncPreflightAction =
  | 'delete-remote'
  | 'forget-missing-local'
  | 'create-remote'
  | 'mark-synced'
  | 'push-local-with-expected-revision'
  | 'compare-remote-archive'

export function getCloudSyncProjectSyncPreflightAction({
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
}): CloudSyncProjectSyncPreflightAction {
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

export type CloudSyncRemoteArchiveReconciliationAction =
  | 'mark-synced'
  | 'hydrate-clean-local'
  | 'mark-conflict'

export function getCloudSyncRemoteArchiveReconciliationAction({
  hasBaseManifest,
  localMatchesRemote,
  localClean,
}: {
  hasBaseManifest: boolean
  localMatchesRemote: boolean
  localClean: boolean
}): CloudSyncRemoteArchiveReconciliationAction {
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

export type CloudSyncRemoteIndexAction =
  | 'skip'
  | 'sync-known-local'
  | 'adopt-matching-local'
  | 'index-remote'

export function getCloudSyncRemoteIndexAction({
  hasRemoteProjectId,
  isRemoteProjectTombstoned,
  hasKnownLocalMetadata,
  hasMatchingLocalProject,
}: {
  hasRemoteProjectId: boolean
  isRemoteProjectTombstoned: boolean
  hasKnownLocalMetadata: boolean
  hasMatchingLocalProject: boolean
}): CloudSyncRemoteIndexAction {
  if (!hasRemoteProjectId || isRemoteProjectTombstoned) {
    return 'skip'
  }
  if (hasKnownLocalMetadata) {
    return 'sync-known-local'
  }
  if (hasMatchingLocalProject) {
    return 'adopt-matching-local'
  }
  return 'index-remote'
}

export type CloudSyncKnownLocalRemoteIndexAction =
  | 'defer-pending-local-changes'
  | 'sync-known-local'
  | 'index-known-local'

export function getCloudSyncKnownLocalRemoteIndexAction({
  hasPendingLocalChanges,
  remoteChanged,
  localChangedFromSyncBase,
}: {
  hasPendingLocalChanges: boolean
  remoteChanged: boolean
  localChangedFromSyncBase: boolean
}): CloudSyncKnownLocalRemoteIndexAction {
  if (hasPendingLocalChanges && remoteChanged) {
    return 'defer-pending-local-changes'
  }
  if (!hasPendingLocalChanges && (remoteChanged || localChangedFromSyncBase)) {
    return 'sync-known-local'
  }

  return 'index-known-local'
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

async function reconcileMissingRemoteProject(
  metadata: ProjectMetadata,
  options: { hasPendingLocalChanges: boolean }
) {
  const localProjectExists = await exists(metadata.localProjectPath)
  let localMatchesBase = false
  if (
    localProjectExists &&
    metadata.baseManifest &&
    !options.hasPendingLocalChanges
  ) {
    localMatchesBase = projectManifestsEqual(
      await collectLocalProjectFiles(metadata.localProjectPath).then(
        projectManifestFromFiles
      ),
      metadata.baseManifest
    )
  }

  const action = getCloudSyncMissingRemoteProjectAction({
    localProjectExists,
    hasPendingLocalChanges: options.hasPendingLocalChanges,
    hasBaseManifest: Boolean(metadata.baseManifest),
    localMatchesBase,
  })

  if (action === 'forget-missing-local') {
    await clearOutboxEntriesForProject(metadata.localProjectPath)
    await deleteProjectMetadata(metadata.localProjectPath)
    return undefined
  }

  if (action === 'remove-clean-local') {
    await clearOutboxEntriesForProject(metadata.localProjectPath)
    await localFs.rm(metadata.localProjectPath, { recursive: true })
    await deleteProjectMetadata(metadata.localProjectPath)
    return undefined
  }

  await removeLocalProjectCloudProjectId(metadata.localProjectPath)
  const nextMetadata = {
    ...metadata,
    remoteProjectId: undefined,
    remoteRevision: undefined,
    remoteUpdatedAt: undefined,
    baseManifest: undefined,
    conflict: undefined,
    lastFailure: undefined,
    lastSyncedAt: undefined,
  }
  await putProjectMetadata(nextMetadata)
  if (!options.hasPendingLocalChanges) {
    await appendOutboxEntry({
      projectPath: metadata.localProjectPath,
      kind: 'upsert',
      targetPath: metadata.localProjectPath,
      createdAt: nowIso(),
    })
  }

  return nextMetadata
}

async function localProjectChangedFromSyncBase(metadata: ProjectMetadata) {
  if (!metadata.remoteProjectId) {
    return false
  }
  if (!metadata.baseManifest) {
    return true
  }

  const localManifest = await collectLocalProjectFiles(
    metadata.localProjectPath
  ).then(projectManifestFromFiles)
  return !projectManifestsEqual(localManifest, metadata.baseManifest)
}

async function syncProjectUnlocked(
  projectPath: string,
  entries: OutboxEntry[]
) {
  if (isProjectCloudOperationDeferred(projectPath)) {
    scheduleSync()
    return
  }
  if (await isPartialProjectQuarantined(projectPath)) {
    return
  }

  let metadata = await getOrCreateProjectMetadata(projectPath)
  if (isProjectSyncExcluded(metadata)) {
    await clearOutboxEntriesForProject(metadata.localProjectPath)
    return
  }
  if (projectPathMatchesSyncScope(metadata.localProjectPath)) {
    updateStatus({
      state: 'syncing',
      activeProjectPath: metadata.localProjectPath,
    })
  }

  try {
    metadata = await bindRemoteProjectIdFromToml(metadata)
    if (!shouldAutoSyncLocalProject(metadata) && entries.length === 0) {
      return
    }

    const latestKind = latestOutboxKind(entries)
    const localProjectExists = await exists(metadata.localProjectPath)
    const initialAction = getCloudSyncProjectSyncPreflightAction({
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

    if (metadata.remoteProjectId) {
      await writeLocalProjectCloudProjectId(
        metadata.localProjectPath,
        metadata.remoteProjectId
      )
    }

    let remoteProject: RemoteProject | undefined
    let remoteRevision: Revision | undefined
    let remoteChanged = false
    let localChanged = true
    if (metadata.remoteProjectId) {
      try {
        remoteProject = await getRemoteProject(config, metadata.remoteProjectId)
      } catch (error) {
        if (error instanceof CloudApiError && error.status === 404) {
          await reconcileMissingRemoteProject(metadata, {
            hasPendingLocalChanges: entries.length > 0,
          })
          return
        }

        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw error
      }
      remoteRevision = getRevision(remoteProject)
    }

    await ensureLocalProjectTitle(
      metadata.localProjectPath,
      remoteProject
        ? getRemoteProjectTitleForProjectToml(remoteProject.title)
        : metadata.projectName
    )
    const localFiles = await collectLocalProjectFiles(metadata.localProjectPath)
    const localManifest = await projectManifestFromFiles(localFiles)

    if (metadata.remoteProjectId) {
      remoteChanged =
        Boolean(metadata.remoteRevision && remoteRevision) &&
        metadata.remoteRevision !== remoteRevision
      localChanged = metadata.baseManifest
        ? !projectManifestsEqual(localManifest, metadata.baseManifest)
        : true
    }

    const preflightAction = getCloudSyncProjectSyncPreflightAction({
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
    const remoteFiles = filterCloudSyncProjectFilesForSync(
      withRemoteProjectMetadataInArchiveFiles(
        await parseProjectArchive(remoteArchive),
        remoteProject.title,
        remoteProjectId,
        getEnvironmentName()
      )
    )
    const remoteManifest = await projectManifestFromFiles(remoteFiles)

    const localMatchesRemote = projectManifestsEqual(
      localManifest,
      remoteManifest
    )
    const reconciliationAction = getCloudSyncRemoteArchiveReconciliationAction({
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

async function syncProject(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  if (isProjectCloudOperationDeferred(normalizedProjectPath)) {
    scheduleSync()
    return
  }

  await withCloudSyncProjectLock(normalizedProjectPath, async () => {
    const currentEntries = outboxEntriesForProject(
      await getAllOutboxEntries(),
      normalizedProjectPath
    )
    await syncProjectUnlocked(normalizedProjectPath, currentEntries)
  })
}

async function syncRemoteIndex() {
  const now = Date.now()
  if (now - lastRemoteIndexSyncAt < REMOTE_INDEX_INTERVAL_MS) {
    return
  }

  const projectDirectory = getConfiguredProjectDirectoryPath()
  await localFs.mkdir(projectDirectory, { recursive: true })

  const remoteProjects = await listRemoteProjects(config)
  cloudSyncRemoteProjects.value = remoteProjects
  const remoteProjectIds = new Set(
    remoteProjects.map((remoteProject) => remoteProject.id).filter(Boolean)
  )
  let metadata = (await getAllProjectMetadata()).filter(
    (entry) =>
      !isProjectSyncExcluded(entry) &&
      !isProjectCloudOperationDeferred(entry.localProjectPath)
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
  const removeMetadata = (projectPath: string) => {
    const normalizedProjectPath = normalizePathForSync(projectPath)
    metadata = metadata.filter(
      (entry) =>
        normalizePathForSync(entry.localProjectPath) !== normalizedProjectPath
    )
  }

  for (const localMetadata of [...metadata]) {
    if (
      !localMetadata.remoteProjectId ||
      localMetadata.tombstone ||
      remoteProjectIds.has(localMetadata.remoteProjectId)
    ) {
      continue
    }

    try {
      await withCloudSyncProjectLock(
        localMetadata.localProjectPath,
        async () => {
          if (isProjectCloudOperationDeferred(localMetadata.localProjectPath)) {
            return
          }
          if (
            await isPartialProjectQuarantined(localMetadata.localProjectPath)
          ) {
            return
          }
          const currentMetadata = await getProjectMetadata(
            localMetadata.localProjectPath
          )
          if (
            !currentMetadata?.remoteProjectId ||
            currentMetadata.remoteProjectId !== localMetadata.remoteProjectId ||
            currentMetadata.tombstone
          ) {
            return
          }
          const currentProjectEntries = outboxEntriesForProject(
            await getAllOutboxEntries(),
            currentMetadata.localProjectPath
          )

          const nextMetadata = await reconcileMissingRemoteProject(
            currentMetadata,
            {
              hasPendingLocalChanges: currentProjectEntries.length > 0,
            }
          )
          if (nextMetadata) {
            upsertMetadata(nextMetadata)
          } else {
            removeMetadata(currentMetadata.localProjectPath)
          }
        }
      )
    } catch (error) {
      failures.push(error)
    }
  }

  for (const remoteProject of remoteProjects) {
    const skipAction = getCloudSyncRemoteIndexAction({
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
      let knownLocalMetadata = metadata.find(
        (entry) => entry.remoteProjectId === remoteProject.id
      )
      const knownLocalAction = getCloudSyncRemoteIndexAction({
        hasRemoteProjectId: Boolean(remoteProject.id),
        isRemoteProjectTombstoned: false,
        hasKnownLocalMetadata: Boolean(knownLocalMetadata),
        hasMatchingLocalProject: false,
      })
      if (knownLocalAction === 'sync-known-local' && knownLocalMetadata) {
        const knownMetadataPath = knownLocalMetadata.localProjectPath
        await withCloudSyncProjectLock(knownMetadataPath, async () => {
          if (isProjectCloudOperationDeferred(knownMetadataPath)) {
            return
          }
          if (await isPartialProjectQuarantined(knownMetadataPath)) {
            return
          }
          const currentMetadata = await getProjectMetadata(knownMetadataPath)
          if (currentMetadata?.remoteProjectId !== remoteProject.id) {
            return
          }
          knownLocalMetadata = currentMetadata
          const currentProjectEntries = outboxEntriesForProject(
            await getAllOutboxEntries(),
            currentMetadata.localProjectPath
          )

          const knownLocalProjectPath = projectPathInDirectory(
            knownLocalMetadata,
            projectDirectory
          )
          const knownLocalPathIsCurrent =
            knownLocalProjectPath && (await exists(knownLocalProjectPath))
          if (!knownLocalPathIsCurrent) {
            await deleteProjectMetadata(knownLocalMetadata.localProjectPath)
            metadata = metadata.filter((entry) => entry !== knownLocalMetadata)
            return
          }

          const hasPendingLocalChanges = currentProjectEntries.length > 0
          const nextLocalMetadata = hasPendingLocalChanges
            ? knownLocalMetadata
            : await hydrateCleanLocalProjectTitle(
                knownLocalMetadata,
                remoteProject.title
              )
          const remoteRevision = getRevision(remoteProject)
          const hasUnqueuedLocalChanges =
            !hasPendingLocalChanges &&
            (await localProjectChangedFromSyncBase(nextLocalMetadata))
          const remoteChanged = Boolean(
            remoteRevision &&
              nextLocalMetadata.remoteRevision &&
              remoteRevision !== nextLocalMetadata.remoteRevision
          )
          const knownLocalRemoteIndexAction =
            getCloudSyncKnownLocalRemoteIndexAction({
              hasPendingLocalChanges,
              remoteChanged,
              localChangedFromSyncBase: hasUnqueuedLocalChanges,
            })

          if (knownLocalRemoteIndexAction === 'defer-pending-local-changes') {
            const remoteUpdatedAt = getRemoteUpdatedAt(remoteProject)
            if (remoteUpdatedAt) {
              const indexedMetadata = {
                ...nextLocalMetadata,
                remoteUpdatedAt,
              }
              await putProjectMetadata(indexedMetadata)
              upsertMetadata(indexedMetadata)
            }
            return
          }

          if (knownLocalRemoteIndexAction === 'sync-known-local') {
            await syncProjectUnlocked(
              nextLocalMetadata.localProjectPath,
              currentProjectEntries
            )
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
        })
        continue
      }

      const projectName = localProjectNameForRemoteProject(remoteProject)
      const existingProjectPath = await findLocalProjectPathByRemoteProjectId(
        projectDirectory,
        remoteProject.id,
        projectName
      )
      if (existingProjectPath) {
        await withCloudSyncProjectLock(existingProjectPath, async () => {
          if (isProjectCloudOperationDeferred(existingProjectPath)) {
            return
          }
          if (await isPartialProjectQuarantined(existingProjectPath)) {
            return
          }
          const currentProjectId = await readProjectTomlCloudProjectId(
            existingProjectPath
          ).catch(() => undefined)
          if (currentProjectId !== remoteProject.id) {
            return
          }

          const nextMetadata = {
            ...(await getOrCreateProjectMetadata(existingProjectPath)),
            remoteProjectId: remoteProject.id,
            remoteUpdatedAt: getRemoteUpdatedAt(remoteProject),
          }
          await putProjectMetadata(nextMetadata)
          upsertMetadata(nextMetadata)
          const currentProjectEntries = outboxEntriesForProject(
            await getAllOutboxEntries(),
            existingProjectPath
          )
          await syncProjectUnlocked(existingProjectPath, currentProjectEntries)
          const syncedMetadata = await getProjectMetadata(existingProjectPath)
          if (syncedMetadata) {
            upsertMetadata(syncedMetadata)
          }
        })
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

  if (config.syncExistingLocalProjects === false) {
    initialLocalScanComplete = true
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
    if (isProjectMutationSuppressed(projectPath)) {
      continue
    }
    if (await isPartialProjectQuarantined(projectPath)) {
      continue
    }
    const stat = await localFs.stat(projectPath)
    if (!statIsDirectory(stat)) {
      continue
    }

    const metadata = await getProjectMetadata(projectPath)
    const initialSyncAction = getCloudSyncInitialLocalProjectSyncAction({
      hasBaseManifest: Boolean(metadata?.baseManifest),
      tombstone: Boolean(metadata?.tombstone),
      syncExcluded: isProjectSyncExcluded(metadata),
    })
    if (initialSyncAction === 'skip') {
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
  let resolveActiveCloudSyncRun: (() => void) | undefined
  const runCompletion = new Promise<void>((resolve) => {
    resolveActiveCloudSyncRun = resolve
  })
  activeCloudSyncRunCompletion = runCompletion
  pendingStatusSyncedAt = undefined
  updateStatus({ enabled: true, state: 'syncing' })
  const scopedProjectPath = syncScopeProjectPath
  let remoteIndexFailed = false
  let remoteIndexFailureMessage: string | undefined

  try {
    await repairExistingConflictCopies()

    let entries = await getAllOutboxEntries()
    let syncScopePlan = getCloudSyncScopePlan(entries, scopedProjectPath)
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
      syncScopePlan = getCloudSyncScopePlan(entries, scopedProjectPath)
    }

    for (const projectPath of syncScopePlan.projectPaths.filter(
      (candidatePath) => !isProjectCloudOperationDeferred(candidatePath)
    )) {
      await syncProject(projectPath)
    }

    await refreshPendingCount()
    const syncedAt = pendingStatusSyncedAt
    if (cloudSyncStatus.value.state !== 'conflict' && remoteIndexFailed) {
      updateStatus({
        state: 'failed',
        activeProjectPath: undefined,
        lastFailure: remoteIndexFailureMessage,
        lastFailureAt: nowIso(),
        ...(syncedAt ? { lastSyncedAt: syncedAt } : {}),
      })
      scheduleSync(SYNC_RETRY_MS)
    } else if (cloudSyncStatus.value.state !== 'conflict') {
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
      cloudSyncStatus.value.pendingCount > 0 &&
      cloudSyncStatus.value.state !== 'conflict'
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
    if (activeCloudSyncRunCompletion === runCompletion) {
      activeCloudSyncRunCompletion = undefined
    }
    resolveActiveCloudSyncRun?.()
    pendingStatusSyncedAt = undefined
    if (
      cloudSyncStatus.value.pendingCount > 0 &&
      cloudSyncStatus.value.state !== 'conflict'
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
export function setCloudSyncProjectScope(projectPath?: string) {
  const nextSyncScopeProjectPath = getSyncScopeProjectPath(projectPath)
  if (syncScopeProjectPath === nextSyncScopeProjectPath) {
    return
  }

  syncScopeProjectPath = nextSyncScopeProjectPath
  void refreshPendingCount()

  const statusProjectPath = cloudSyncStatus.value.activeProjectPath
    ? normalizePathForSync(cloudSyncStatus.value.activeProjectPath)
    : undefined
  if (
    nextSyncScopeProjectPath &&
    cloudSyncStatus.value.state !== 'disabled' &&
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

async function startCloudSyncProjectUnlocked(normalizedProjectPath: string) {
  const stat = await localFs.stat(normalizedProjectPath)
  if (!statIsDirectory(stat)) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('Cloud sync can only start from a project directory.')
  }

  const metadata = await bindRemoteProjectIdFromToml(
    await getOrCreateProjectMetadata(normalizedProjectPath)
  )

  await clearOutboxEntriesForProject(normalizedProjectPath)
  await putProjectMetadata({
    ...metadata,
    localProjectPath: normalizedProjectPath,
    projectName: projectNameFromPath(normalizedProjectPath),
    tombstone: false,
    syncExcluded: undefined,
    conflict: undefined,
    lastFailure: undefined,
  })
  await appendOutboxEntry({
    projectPath: normalizedProjectPath,
    kind: 'upsert',
    targetPath: normalizedProjectPath,
    createdAt: nowIso(),
  })
  updateStatus({
    state: 'idle',
    activeProjectPath: undefined,
    lastFailure: undefined,
    lastFailureAt: undefined,
  })
  scheduleSync(0)
}

/**
 * User-initiated project enrollment. This bypasses the automatic enrollment
 * policy so local-only projects can be opted into cloud sync one at a time.
 */
export async function startCloudSyncProject(projectPath: string) {
  if (!isConfiguredForCloud()) {
    return Promise.reject(new Error('Cloud sync is not enabled.'))
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  if (isProjectMutationSuppressed(normalizedProjectPath)) {
    return Promise.reject(
      projectWriteTransactionActiveError(normalizedProjectPath)
    )
  }

  await withCloudSyncProjectLock(normalizedProjectPath, async () => {
    await requireCloudProjectOperationReady(normalizedProjectPath)
    await startCloudSyncProjectUnlocked(normalizedProjectPath)
  })
}

async function disconnectCloudSyncProjectUnlocked(
  normalizedProjectPath: string
) {
  const metadata = await bindRemoteProjectIdFromToml(
    await getOrCreateProjectMetadata(normalizedProjectPath)
  )
  const remoteProjectId = metadata.remoteProjectId
  const disconnectedAt = nowIso()

  await removeLocalProjectCloudProjectId(normalizedProjectPath)
  await putProjectMetadata({
    ...metadata,
    localProjectPath: normalizedProjectPath,
    projectName: projectNameFromPath(normalizedProjectPath),
    remoteProjectId: undefined,
    remoteRevision: undefined,
    remoteUpdatedAt: undefined,
    baseManifest: undefined,
    tombstone: false,
    conflict: undefined,
    lastFailure: undefined,
    lastSyncedAt: undefined,
    syncExcluded: {
      reason: 'user-disconnected',
      remoteProjectId,
      createdAt: disconnectedAt,
    },
  })

  if (remoteProjectId) {
    try {
      await deleteRemoteProject(config, remoteProjectId)
    } catch (error) {
      if (!(error instanceof CloudApiError && error.status === 404)) {
        await putProjectMetadata({
          ...metadata,
          localProjectPath: normalizedProjectPath,
          projectName: projectNameFromPath(normalizedProjectPath),
          syncExcluded: undefined,
        })
        await writeLocalProjectCloudProjectId(
          normalizedProjectPath,
          remoteProjectId
        ).catch(markCloudMetadataFailure)
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw error
      }
    }
  }

  await clearOutboxEntriesForProject(normalizedProjectPath)
  await putProjectMetadata({
    ...metadata,
    localProjectPath: normalizedProjectPath,
    projectName: projectNameFromPath(normalizedProjectPath),
    remoteProjectId: undefined,
    remoteRevision: undefined,
    remoteUpdatedAt: undefined,
    baseManifest: undefined,
    tombstone: false,
    conflict: undefined,
    lastFailure: undefined,
    lastSyncedAt: undefined,
    syncExcluded: {
      reason: 'user-disconnected',
      remoteProjectId,
      createdAt: disconnectedAt,
    },
  })
  if (remoteProjectId) {
    cloudSyncRemoteProjects.value = cloudSyncRemoteProjects.value.filter(
      (project) => project.id !== remoteProjectId
    )
  }
  updateStatus({
    state: 'idle',
    activeProjectPath: undefined,
    lastFailure: undefined,
    lastFailureAt: undefined,
    lastSyncedAt: disconnectedAt,
  })
  scheduleRemoteIndexSync(0)
}

/**
 * User-initiated disconnect. Local metadata is detached before remote deletion
 * so a concurrent remote-index sync cannot mirror the remote delete into a
 * local directory delete.
 */
export async function disconnectCloudSyncProject(projectPath: string) {
  if (!isConfiguredForCloud()) {
    return Promise.reject(new Error('Cloud sync is not enabled.'))
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  if (isProjectMutationSuppressed(normalizedProjectPath)) {
    return Promise.reject(
      projectWriteTransactionActiveError(normalizedProjectPath)
    )
  }

  await withCloudSyncProjectLock(normalizedProjectPath, async () => {
    await requireCloudProjectOperationReady(normalizedProjectPath)
    await disconnectCloudSyncProjectUnlocked(normalizedProjectPath)
  })
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

async function registerProjectMutationUnlocked(
  projectPath: string,
  kind: OutboxEntry['kind'],
  targetPath: string,
  sourcePath?: string,
  options: { ignoreMutationSuppression?: boolean } = {}
) {
  if (!isConfiguredForCloud() || isInternalOpfsPath(targetPath)) {
    return
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  if (
    (!options.ignoreMutationSuppression &&
      isProjectMutationSuppressed(normalizedProjectPath)) ||
    projectNameFromPath(normalizedProjectPath).startsWith('.')
  ) {
    return
  }
  if (await isPartialProjectQuarantined(normalizedProjectPath)) {
    return
  }
  let metadata = await getOrCreateProjectMetadata(normalizedProjectPath)
  if (isProjectSyncExcluded(metadata)) {
    await clearOutboxEntriesForProject(normalizedProjectPath)
    return
  }
  metadata = await bindRemoteProjectIdFromToml(metadata)
  if (!shouldAutoSyncLocalProject(metadata)) {
    await putProjectMetadata(metadata)
    return
  }

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
  if (
    isProjectMutationSuppressed(normalizedProjectPath) ||
    projectNameFromPath(normalizedProjectPath).startsWith('.')
  ) {
    return
  }

  await withCloudSyncProjectLock(normalizedProjectPath, async () => {
    await registerProjectMutationUnlocked(
      normalizedProjectPath,
      kind,
      targetPath,
      sourcePath
    )
  })
}

async function registerProjectRename(sourcePath: string, targetPath: string) {
  if (!isConfiguredForCloud()) {
    return
  }

  const sourceProjectRoot = getConfiguredProjectRoot(sourcePath)
  const targetProjectRoot = getConfiguredProjectRoot(targetPath)
  if (!targetProjectRoot) {
    return
  }
  const projectRoots = [targetProjectRoot]
  if (sourceProjectRoot) {
    projectRoots.push(sourceProjectRoot)
  }
  if (projectRoots.some(isProjectMutationSuppressed)) {
    return
  }

  await withCloudSyncProjectLocks(projectRoots, async () => {
    if (projectRoots.some(isProjectMutationSuppressed)) {
      return
    }
    for (const projectRoot of new Set(projectRoots.map(normalizePathForSync))) {
      if (await isPartialProjectQuarantined(projectRoot)) {
        return
      }
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
        if (isProjectSyncExcluded(sourceMetadata)) {
          return
        }
      }
    }

    await registerProjectMutationUnlocked(
      targetProjectRoot,
      'upsert',
      targetPath,
      sourcePath
    )
  })
}

async function afterWriteLikeMutation(targetPath: string) {
  const projectRoot = getConfiguredProjectRoot(targetPath)
  if (!projectRoot) {
    if (isConfiguredProjectDirectoryPath(targetPath)) {
      scheduleSync()
    }
    return
  }

  await registerProjectMutation(projectRoot, 'upsert', targetPath)
}

async function afterRemoveMutation(targetPath: string) {
  const projectRoot = getConfiguredProjectRoot(targetPath)
  if (!projectRoot) {
    return
  }

  await registerProjectMutation(
    projectRoot,
    isProjectRootPath(targetPath, projectRoot) ? 'delete' : 'upsert',
    targetPath
  )
}

export function configureCloudSyncLocalFileSystem(
  nextLocalFs: IZooDesignStudioFS
) {
  localFs = nextLocalFs
}

export async function notifyCloudSyncWriteLikeMutation(targetPath: string) {
  await afterWriteLikeMutation(targetPath).catch(markCloudMetadataFailure)
}

export async function notifyCloudSyncRemoveMutation(targetPath: string) {
  await afterRemoveMutation(targetPath).catch(markCloudMetadataFailure)
}

export async function notifyCloudSyncRenameMutation(
  sourcePath: string,
  targetPath: string
) {
  await registerProjectRename(sourcePath, targetPath).catch(
    markCloudMetadataFailure
  )
}

async function resetCloudSyncProjectIdentity(projectPath: string) {
  // Desktop/unit-test contexts can duplicate projects without ever installing
  // the browser cloud-sync persistence layer.
  if (typeof indexedDB === 'undefined') {
    return
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  const pendingDeletionPath = normalizePathForSync(
    localFs.join(
      localFs.dirname(normalizedProjectPath),
      `.zds-cloud-delete-${crypto.randomUUID()}`
    )
  )
  const preservedRemoteDeletion = await resetProjectSyncIdentity(
    normalizedProjectPath,
    pendingDeletionPath
  )
  await refreshPendingCount()
  if (preservedRemoteDeletion) {
    scheduleSync()
  }
}

/**
 * Clears path-keyed cloud state before duplicate recovery removes an owned,
 * incomplete target. No local mutation is registered for the abandoned copy.
 */
export async function resetCloudSyncProjectIdentityForRecovery(
  projectPath: string
) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  if (isProjectMutationSuppressed(normalizedProjectPath)) {
    return Promise.reject(
      projectWriteTransactionActiveError(normalizedProjectPath)
    )
  }

  await withCloudSyncProjectLock(normalizedProjectPath, async () => {
    if (isProjectMutationSuppressed(normalizedProjectPath)) {
      return Promise.reject(
        projectWriteTransactionActiveError(normalizedProjectPath)
      )
    }
    await resetCloudSyncProjectIdentity(normalizedProjectPath)
  })
}

export type CloudSyncWriteTransactionOptions = {
  /** Discards any prior path-keyed sync identity after a successful commit. */
  freshProjectIdentity?: boolean
  /** Finalizes the filesystem commit after its fresh cloud identity is safe. */
  afterFreshIdentityReset?: () => Promise<void>
}

/**
 * Holds the same project lock used by cloud hydration while a stable local
 * snapshot is read. Unlike a write transaction, this never suppresses observed
 * mutations or emits a final registration.
 */
export async function runCloudSyncProjectReadTransaction<T>(
  projectPath: string,
  operation: () => Promise<T>
) {
  const { isOutermostRead, normalizedProjectPath, lease } =
    leaseProjectForRead(projectPath)
  const executeRead = async () => {
    if (!isOutermostRead) {
      await lease.webLockReady
    }
    try {
      return await operation()
    } finally {
      finishProjectRead(normalizedProjectPath, lease)
    }
  }

  if (!isOutermostRead) {
    return executeRead()
  }

  try {
    if (!hasCloudSyncProjectLocks()) {
      const inProgressSync = activeCloudSyncRunCompletion
      if (inProgressSync) {
        await inProgressSync
      }
    }

    return await withCloudSyncProjectLock(normalizedProjectPath, async () => {
      lease.resolveWebLockReady()
      try {
        return await executeRead()
      } finally {
        await lease.readsComplete
        releaseProjectReadLease(normalizedProjectPath, lease)
      }
    })
  } finally {
    releaseProjectReadLease(normalizedProjectPath, lease)
    // A remote-index or conflict-copy repair pass can deliberately skip a
    // read-leased project and still mark its global pass complete. Invalidate
    // both completion markers and retry once the source snapshot is released.
    conflictCopyRepairComplete = false
    scheduleRemoteIndexSync(0)
  }
}

/**
 * Prevents cloud sync from observing a project while a multi-step filesystem
 * operation is incomplete, then reports the finished project exactly once.
 */
export async function runCloudSyncWriteTransaction<T>(
  projectPath: string,
  operation: () => Promise<T>,
  options: CloudSyncWriteTransactionOptions = {}
) {
  const { isOutermostTransaction, normalizedProjectPath, suppression } =
    suppressProjectMutations(projectPath)

  const executeTransaction = async () => {
    let result!: T
    try {
      if (!isOutermostTransaction) {
        await suppression.webLockReady
      }

      result = await operation()
      if (options.freshProjectIdentity) {
        suppression.freshProjectIdentityRequested = true
        if (options.afterFreshIdentityReset) {
          suppression.afterFreshIdentityResetCallbacks.push(
            options.afterFreshIdentityReset
          )
        }
      }
      suppression.commitRequested = true
    } finally {
      resumeProjectMutations(suppression)
    }
    return result
  }

  if (!isOutermostTransaction) {
    return executeTransaction()
  }

  let result!: T
  let operationError: unknown
  let operationFailed = false
  let finalizationError: unknown
  let finalizationFailed = false
  let suppressionReleased = false
  const releaseSuppression = () => {
    if (suppressionReleased) {
      return
    }
    suppressionReleased = true
    releaseProjectMutationSuppression(normalizedProjectPath, suppression)
  }

  try {
    // Suppression is installed synchronously above, so a newly scheduled local
    // run skips this path while an already-active fallback run drains. This
    // wait must happen before acquiring the Web Lock to preserve lock ordering.
    if (!hasCloudSyncProjectLocks()) {
      const inProgressSync = activeCloudSyncRunCompletion
      if (inProgressSync) {
        await inProgressSync
      }
    }

    await withCloudSyncProjectLock(normalizedProjectPath, async () => {
      suppression.resolveWebLockReady()
      try {
        try {
          result = await executeTransaction()
        } catch (error) {
          operationFailed = true
          operationError = error
        }
        await suppression.transactionsComplete
        if (
          suppression.commitRequested &&
          suppression.freshProjectIdentityRequested
        ) {
          try {
            await resetCloudSyncProjectIdentity(normalizedProjectPath)
          } catch (error) {
            suppression.freshProjectIdentityResetFailed = true
            finalizationFailed = true
            finalizationError = error
          }

          if (!suppression.freshProjectIdentityResetFailed) {
            for (const finalizeFreshIdentity of suppression.afterFreshIdentityResetCallbacks) {
              try {
                await finalizeFreshIdentity()
              } catch (error) {
                suppression.freshProjectIdentityResetFailed = true
                finalizationFailed = true
                finalizationError = error
                break
              }
            }
          }
        }

        if (
          suppression.commitRequested &&
          !suppression.freshProjectIdentityResetFailed
        ) {
          // Publish the final cloud identity before releasing the shared lock.
          // Local suppression must be lifted first so the unlocked registrar
          // accepts this one intentional commit notification.
          releaseSuppression()
          await registerProjectMutationUnlocked(
            normalizedProjectPath,
            'upsert',
            normalizedProjectPath,
            undefined,
            { ignoreMutationSuppression: true }
          ).catch(markCloudMetadataFailure)
        }
      } finally {
        releaseSuppression()
      }
    })
  } finally {
    // Covers failures from a partial/host-provided Web Locks implementation.
    releaseSuppression()
  }

  if (finalizationFailed) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw finalizationError instanceof Error
      ? finalizationError
      : new Error(String(finalizationError))
  }

  if (operationFailed) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw operationError instanceof Error
      ? operationError
      : new Error(String(operationError))
  }

  return result
}

export function configureCloudSyncEngine(nextConfig: CloudSyncConfig) {
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
  const syncPolicyChanged =
    previousConfig.syncExistingLocalProjects !==
    config.syncExistingLocalProjects
  if (cloudIdentityChanged || projectDirectoryChanged || syncPolicyChanged) {
    lastRemoteIndexSyncAt = 0
    initialLocalScanComplete = false
    conflictCopyRepairComplete = false
  }

  if (!config.enabled) {
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = undefined
    }
    detachVisibilityChangeListener?.()
    initialLocalScanComplete = false
    conflictCopyRepairComplete = false
    lastRemoteIndexSyncAt = 0
    cloudSyncRemoteProjects.value = []
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

export function retryCloudSyncEngine() {
  if (syncScopeProjectPath) {
    scheduleSync(0)
    return
  }

  scheduleRemoteIndexSync()
}
