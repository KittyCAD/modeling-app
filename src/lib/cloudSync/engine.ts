import { signal } from '@preact/signals-core'
import env, { getEnvironmentNameFromEnv } from '@src/env'
import {
  reportCloudSyncConflict,
  reportCloudSyncFailure,
  reportCloudSyncUntrackedLocalChanges,
} from '@src/lib/cloudSync/clientErrorReporting'
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
  buildConflictInspectionFromCloudFiles,
  type ConflictInspection,
} from '@src/lib/cloudSync/conflictInspection'
import {
  isCloudSyncExcludedPath,
  isProjectRootPath,
  normalizePathForSync,
  normalizeRelativePath,
} from '@src/lib/cloudSync/paths'
import {
  getRemoteProjectTitleForProjectToml,
  normalizeProjectArchiveFilesForCloudSync,
  parseProjectArchive,
  projectManifestFromFiles,
  projectManifestsEqual,
  toArrayBuffer,
  withRemoteProjectMetadataInArchiveFiles,
  withUpdatedProjectTomlInArchiveFiles,
} from '@src/lib/cloudSync/projectArchive'
import {
  appendOutboxEntry as appendSyncDbOutboxEntry,
  clearLegacyConflictCopyReferences,
  clearOutboxEntriesForProject as clearSyncDbOutboxEntriesForProject,
  clearOutboxEntriesTouchingProject as clearSyncDbOutboxEntriesTouchingProject,
  deleteProjectMetadata,
  getAllOutboxEntries,
  getAllProjectMetadata,
  getProjectMetadata,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import type {
  CloudSyncConfig,
  CloudSyncLocalProject,
  CloudSyncOpenedProject,
  CloudSyncProjectMetadataIndexEntry,
  CloudSyncStatus,
  OutboxEntry,
  ProjectArchiveFile,
  ProjectManifest,
  ProjectMetadata,
  ProjectSyncFailureKind,
  RemoteProject,
  RemoteProjectSummary,
  Revision,
} from '@src/lib/cloudSync/types'
import {
  DUPLICATE_PROJECT_TEMPORARY_PREFIX,
  PROJECT_IMAGE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
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
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import {
  getProjectDirectoryNameFromTitle,
  getUniqueDuplicateProjectName,
  sanitizeProjectName,
} from '@src/lib/projectName'
import {
  getCloudProjectIdFromProjectTomlContents,
  getProjectTitleFromProjectTomlContents,
  prepareProjectTomlForDuplication,
  removeCloudProjectIdFromProjectTomlContents,
  setCloudProjectIdInProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isErr, reportRejection } from '@src/lib/trap'
import { v4 } from 'uuid'

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

export class CloudSyncConflictRevisionChangedError extends Error {
  constructor() {
    super(
      'Cloud project changed since conflict details were loaded. Review the latest cloud version before resolving.'
    )
    this.name = 'CloudSyncConflictRevisionChangedError'
  }
}

export function isCloudSyncConflictRevisionChangedError(error: unknown) {
  return (
    error instanceof CloudSyncConflictRevisionChangedError ||
    (error instanceof Error &&
      error.name === 'CloudSyncConflictRevisionChangedError')
  )
}

const SYNC_DEBOUNCE_MS = 2500
const SYNC_RETRY_MS = 10_000
const SYNC_RETRY_MAX_MS = 5 * 60 * 1000
const PROJECT_API_THROTTLE_MS = 250
const PROJECT_API_THROTTLE_JITTER_MS = 250
const REMOTE_INDEX_INTERVAL_MS = 5 * 60 * 1000
const REMOTE_UPLOAD_FORBIDDEN_MESSAGE =
  'Cloud sync cannot upload local changes because this account does not have edit access to the linked cloud project. Local changes are safe on this device.'

let localFs: IZooDesignStudioFS = opfs.impl

let config: CloudSyncConfig = {
  enabled: false,
}
let syncTimer: ReturnType<typeof setTimeout> | undefined
let syncInProgress = false
let syncRetryAttempt = 0
let lastRemoteIndexSyncAt = 0
let initialLocalScanComplete = false
let pendingStatusSyncedAt: string | undefined
let detachVisibilityChangeListener: (() => void) | undefined
let openedProjectContext: CloudSyncOpenedProject | undefined
let syncScopeProjectPath: string | undefined
let syncScopeSyncable = false
const scheduledProjectDirectoryNameSyncs = new Set<string>()

/**
 * Per-run throttle for automatic full-library syncs. It spaces project API
 * request starts so large local backlogs drain without a tight startup burst.
 */
type CloudSyncProjectApiRequestThrottle = () => Promise<void>

const unthrottledCloudSyncProjectApiRequest: CloudSyncProjectApiRequestThrottle =
  async () => undefined

export const cloudSyncStatus = signal<CloudSyncStatus>({
  enabled: false,
  state: 'disabled',
  pendingCount: 0,
})
export const cloudSyncRemoteProjects = signal<RemoteProjectSummary[]>([])

function updateStatus(next: Partial<CloudSyncStatus>) {
  const shouldClearFailureKind =
    Object.hasOwn(next, 'lastFailure') &&
    !Object.hasOwn(next, 'lastFailureKind')
  cloudSyncStatus.value = {
    ...cloudSyncStatus.value,
    ...next,
    ...(shouldClearFailureKind ? { lastFailureKind: undefined } : {}),
  }
}

function nowIso() {
  return new Date().toISOString()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isProjectSyncFailureKind(
  value: unknown
): value is ProjectSyncFailureKind {
  return value === 'remote-upload-forbidden'
}

function projectFailureKind(error: unknown) {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const kind = error.kind
    return isProjectSyncFailureKind(kind) ? kind : undefined
  }
  return undefined
}

function projectFailureError(
  kind: ProjectSyncFailureKind,
  message: string,
  options: { retryAfterMs?: number } = {}
): Error & { kind: ProjectSyncFailureKind; retryAfterMs?: number } {
  const error = new Error(message) as Error & {
    kind: ProjectSyncFailureKind
    retryAfterMs?: number
  }
  error.kind = kind
  error.retryAfterMs = options.retryAfterMs
  return error
}

function remoteUploadFailureFromError(error: unknown) {
  return error instanceof CloudApiError && error.status === 403
    ? projectFailureError(
        'remote-upload-forbidden',
        REMOTE_UPLOAD_FORBIDDEN_MESSAGE,
        { retryAfterMs: error.retryAfterMs }
      )
    : error
}

function rejectRemoteUploadFailure(error: unknown): Promise<never> {
  return Promise.reject(remoteUploadFailureFromError(error))
}

function cloudApiRetryAfterMs(error: unknown): number | undefined {
  if (error instanceof CloudApiError) {
    return error.retryAfterMs
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'retryAfterMs' in error &&
    typeof error.retryAfterMs === 'number'
  ) {
    return error.retryAfterMs
  }
  if (error instanceof Error && error.cause !== undefined) {
    return cloudApiRetryAfterMs(error.cause)
  }
  return undefined
}

export function getCloudSyncRetryDelayMs({
  attempt,
  retryAfterMs,
}: {
  attempt: number
  retryAfterMs?: number
}) {
  const normalizedAttempt = Math.max(0, Math.floor(attempt))
  const exponentialDelay = Math.min(
    SYNC_RETRY_MAX_MS,
    SYNC_RETRY_MS * 2 ** normalizedAttempt
  )

  return Math.max(exponentialDelay, retryAfterMs ?? 0)
}

function nextSyncRetryDelayMs(error: unknown) {
  const retryDelay = getCloudSyncRetryDelayMs({
    attempt: syncRetryAttempt,
    retryAfterMs: cloudApiRetryAfterMs(error),
  })
  syncRetryAttempt =
    retryDelay >= SYNC_RETRY_MAX_MS ? syncRetryAttempt : syncRetryAttempt + 1

  return retryDelay
}

function resetSyncRetryBackoff() {
  syncRetryAttempt = 0
}

export function getCloudSyncProjectApiThrottleDelayMs({
  elapsedMs,
  jitterRatio,
}: {
  elapsedMs: number
  jitterRatio: number
}) {
  const clamp = (value: number, min: number, max: number) => {
    if (!Number.isFinite(value)) {
      return min
    }
    return Math.min(max, Math.max(min, value))
  }
  const intervalMs =
    PROJECT_API_THROTTLE_MS +
    Math.round(PROJECT_API_THROTTLE_JITTER_MS * clamp(jitterRatio, 0, 1))

  return Math.max(0, intervalMs - Math.max(0, Math.floor(elapsedMs)))
}

export function shouldThrottleCloudSyncProjectApiRequests({
  hasSyncScope,
  projectCount,
}: {
  hasSyncScope: boolean
  projectCount: number
}) {
  return !hasSyncScope && projectCount > 1
}

function createCloudSyncProjectApiRequestThrottle({
  enabled,
}: {
  enabled: boolean
}): CloudSyncProjectApiRequestThrottle {
  if (!enabled) {
    return unthrottledCloudSyncProjectApiRequest
  }

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    })

  let lastRequestStartedAt: number | undefined
  return async () => {
    if (lastRequestStartedAt !== undefined) {
      const delayMs = getCloudSyncProjectApiThrottleDelayMs({
        elapsedMs: Date.now() - lastRequestStartedAt,
        jitterRatio: Math.random(),
      })
      if (delayMs > 0) {
        await sleep(delayMs)
      }
    }
    lastRequestStartedAt = Date.now()
  }
}

async function runCloudSyncProjectApiRequest<T>(
  throttleProjectApiRequest: CloudSyncProjectApiRequestThrottle,
  request: () => Promise<T>
) {
  await throttleProjectApiRequest()
  return request()
}

export function shouldScheduleCloudSyncPendingWork({
  pendingCount,
  state,
  failureRetryScheduled,
}: {
  pendingCount: number
  state: CloudSyncStatus['state']
  failureRetryScheduled: boolean
}) {
  return pendingCount > 0 && state !== 'conflict' && !failureRetryScheduled
}

export function getCloudSyncProjectRootInDirectory(
  targetPath: string,
  projectDirectoryPath: string
) {
  const normalizedTargetPath = normalizePathForSync(targetPath)
  const projectDirectory = normalizePathForSync(projectDirectoryPath)
  if (normalizedTargetPath === projectDirectory) {
    return undefined
  }

  if (!normalizedTargetPath.startsWith(`${projectDirectory}/`)) {
    return undefined
  }

  const relativePath = normalizeRelativePath(
    normalizedTargetPath.slice(projectDirectory.length + 1)
  )
  const [projectName] = webSafePathSplit(relativePath).filter(Boolean)
  return projectName
    ? normalizePathForSync(`${projectDirectory}/${projectName}`)
    : undefined
}

export function getCloudSyncProjectRootInDirectories(
  targetPath: string,
  projectDirectoryPaths: readonly string[]
) {
  const projectDirectories = [...projectDirectoryPaths].sort(
    (left, right) =>
      normalizePathForSync(right).length - normalizePathForSync(left).length
  )
  for (const projectDirectory of projectDirectories) {
    const projectRoot = getCloudSyncProjectRootInDirectory(
      targetPath,
      projectDirectory
    )
    if (projectRoot) {
      return projectRoot
    }
  }

  return undefined
}

function normalizeCloudLibraryMaterializationPaths(
  projectDirectoryPaths: readonly (string | undefined)[]
) {
  return Array.from(
    new Set(
      projectDirectoryPaths
        .map((projectDirectoryPath) => projectDirectoryPath?.trim())
        .filter((projectDirectoryPath): projectDirectoryPath is string =>
          Boolean(projectDirectoryPath)
        )
        .map(normalizePathForSync)
    )
  )
}

function getCloudLibraryMaterializationPathsForConfig(
  targetConfig: CloudSyncConfig
) {
  return normalizeCloudLibraryMaterializationPaths(
    targetConfig.cloudProjectDirectoryPaths ?? []
  )
}

function getCloudLibraryMaterializationPaths() {
  return getCloudLibraryMaterializationPathsForConfig(config)
}

function getCloudLibraryMaterializationConfigKey(
  targetConfig: CloudSyncConfig
) {
  return getCloudLibraryMaterializationPathsForConfig(targetConfig)
    .sort()
    .join('\0')
}

function getCloudLibraryProjectRoot(targetPath: string) {
  return getCloudSyncProjectRootInDirectories(
    targetPath,
    getCloudLibraryMaterializationPaths()
  )
}

function getScopedProjectRoot(targetPath: string) {
  if (!syncScopeProjectPath || !syncScopeSyncable) {
    return undefined
  }

  const normalizedTargetPath = normalizePathForSync(targetPath)
  return normalizedTargetPath === syncScopeProjectPath ||
    normalizedTargetPath.startsWith(`${syncScopeProjectPath}/`)
    ? syncScopeProjectPath
    : undefined
}

function getSyncPolicyProjectRoot(targetPath: string) {
  return (
    getCloudLibraryProjectRoot(targetPath) ?? getScopedProjectRoot(targetPath)
  )
}

function isCloudLibraryMaterializationPath(targetPath: string) {
  const normalizedTargetPath = normalizePathForSync(targetPath)
  return getCloudLibraryMaterializationPaths().some(
    (projectDirectoryPath) =>
      normalizedTargetPath === normalizePathForSync(projectDirectoryPath)
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

function getOwningCloudLibraryMaterializationPath(projectPath: string) {
  return getCloudLibraryMaterializationPaths().find((projectDirectoryPath) =>
    isProjectPathInDirectory(projectPath, projectDirectoryPath)
  )
}

function isProjectSyncExcluded(metadata: ProjectMetadata | undefined) {
  return Boolean(metadata?.syncExcluded)
}

export function shouldAutoEnrollCloudLibraryProject({
  autoEnrollCloudLibraryProjects,
  hasRemoteProjectId,
  hasBaseManifest,
}: {
  autoEnrollCloudLibraryProjects: boolean | undefined
  hasRemoteProjectId: boolean
  hasBaseManifest: boolean
}) {
  return (
    autoEnrollCloudLibraryProjects !== false ||
    hasRemoteProjectId ||
    hasBaseManifest
  )
}

function shouldSyncCloudLibraryProject(metadata: ProjectMetadata) {
  const autoEnrollCloudLibraryProjects =
    getOwningCloudLibraryMaterializationPath(metadata.localProjectPath)
      ? config.autoEnrollCloudLibraryProjects
      : false

  return shouldAutoEnrollCloudLibraryProject({
    autoEnrollCloudLibraryProjects,
    hasRemoteProjectId: Boolean(metadata.remoteProjectId),
    hasBaseManifest: Boolean(metadata.baseManifest),
  })
}

export function filterCloudSyncProjectFilesForSync(
  files: ProjectArchiveFile[]
) {
  const normalizedFiles = normalizeProjectArchiveFilesForCloudSync(files)
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
      !isCloudSyncExcludedPath(file.relativePath) &&
      !isCloudSyncGeneratedArtifactPath(file.relativePath) &&
      !isPathIgnoredByGitignore(gitignoreStack, file.relativePath, false)
  )
}

function isConfiguredForCloud() {
  return config.enabled === true
}

type CloudSyncOpenedProjectScope = {
  projectPath: string
  syncable: boolean
}

function normalizeCloudSyncOpenedProject(
  openedProject: CloudSyncOpenedProject | undefined
): CloudSyncOpenedProjectScope | undefined {
  if (!openedProject) {
    return undefined
  }

  const projectPath = openedProject.projectPath.trim()
  if (!projectPath) {
    return undefined
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  return {
    projectPath: normalizedProjectPath,
    syncable:
      (openedProject.libraryType === CLOUD_PROJECT_LIBRARY_TYPE &&
        Boolean(openedProject.libraryPath?.trim())) ||
      Boolean(getCloudLibraryProjectRoot(normalizedProjectPath)),
  }
}

function projectPathMatchesSyncScope(projectPath: string) {
  return (
    !syncScopeProjectPath ||
    normalizePathForSync(projectPath) === syncScopeProjectPath
  )
}

function projectPathIsSyncScope(projectPath: string) {
  return Boolean(
    syncScopeProjectPath &&
      normalizePathForSync(projectPath) === syncScopeProjectPath
  )
}

function publishScopedProjectCloudProjectId(metadata: ProjectMetadata) {
  if (!projectPathIsSyncScope(metadata.localProjectPath)) {
    return
  }

  updateStatus({
    scopedProjectCloudProjectId:
      metadata.tombstone || isProjectSyncExcluded(metadata)
        ? undefined
        : metadata.remoteProjectId,
  })
}

async function getScopedProjectCloudProjectId(projectPath: string) {
  const metadata = await getProjectMetadata(projectPath)
  if (metadata?.tombstone || isProjectSyncExcluded(metadata)) {
    return undefined
  }
  if (metadata?.remoteProjectId) {
    return metadata.remoteProjectId
  }

  return readProjectTomlCloudProjectId(projectPath).catch(() => undefined)
}

async function refreshScopedProjectCloudProjectId(
  scope?: CloudSyncOpenedProjectScope
) {
  if (!scope) {
    updateStatus({
      scopedProjectPath: undefined,
      scopedProjectCloudProjectId: undefined,
    })
    return
  }

  const scopedProjectPath = normalizePathForSync(scope.projectPath)
  updateStatus({
    scopedProjectPath,
    scopedProjectCloudProjectId: undefined,
  })
  if (!scope.syncable) {
    return
  }

  try {
    const cloudProjectId =
      await getScopedProjectCloudProjectId(scopedProjectPath)
    if (syncScopeProjectPath === scopedProjectPath) {
      updateStatus({ scopedProjectCloudProjectId: cloudProjectId })
    }
  } catch (error) {
    if (syncScopeProjectPath === scopedProjectPath) {
      updateStatus({ scopedProjectCloudProjectId: undefined })
    }
    reportRejection(error)
  }
}

function outboxEntriesForProject(entries: OutboxEntry[], projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  return entries.filter(
    (entry) => normalizePathForSync(entry.projectPath) === normalizedProjectPath
  )
}

function outboxProjectPaths(entries: OutboxEntry[]) {
  return Array.from(
    new Set(entries.map((entry) => normalizePathForSync(entry.projectPath)))
  )
}

export type CloudSyncScopePlan = {
  shouldSyncRemoteIndex: boolean
  projectPaths: string[]
  pendingCount: number
}

function getCloudSyncScopePlanForScope(
  entries: OutboxEntry[],
  normalizedScope?: CloudSyncOpenedProjectScope
): CloudSyncScopePlan {
  const normalizedScopeProjectPath = normalizedScope?.projectPath
  if (normalizedScopeProjectPath) {
    if (!normalizedScope.syncable) {
      return {
        shouldSyncRemoteIndex: false,
        projectPaths: [],
        pendingCount: 0,
      }
    }

    return {
      shouldSyncRemoteIndex: false,
      projectPaths: [normalizedScopeProjectPath],
      pendingCount: outboxEntriesForProject(entries, normalizedScopeProjectPath)
        .length
        ? 1
        : 0,
    }
  }

  const projectPaths = outboxProjectPaths(entries)
  return {
    shouldSyncRemoteIndex: true,
    projectPaths,
    pendingCount: projectPaths.length,
  }
}

export function getCloudSyncScopePlan(
  entries: OutboxEntry[],
  openedProject?: CloudSyncOpenedProject
): CloudSyncScopePlan {
  return getCloudSyncScopePlanForScope(
    entries,
    normalizeCloudSyncOpenedProject(openedProject)
  )
}

function getEnvironmentName() {
  if (config.environmentName) {
    return config.environmentName
  }

  return getEnvironmentNameFromEnv(env())
}

type ProjectTomlCloudEnvironmentBinding =
  | {
      kind: 'current-environment'
      projectId: string
    }
  | {
      kind: 'other-environment'
      projectId: string
    }
  | {
      kind: 'unbound'
    }

function getProjectTomlCloudEnvironmentBinding(
  projectToml: string
): ProjectTomlCloudEnvironmentBinding {
  const environmentName = getEnvironmentName()
  const currentEnvironmentProjectId = environmentName
    ? getCloudProjectIdFromProjectTomlContents(projectToml, environmentName)
    : undefined
  if (currentEnvironmentProjectId) {
    return {
      kind: 'current-environment',
      projectId: currentEnvironmentProjectId,
    }
  }

  const anyEnvironmentProjectId =
    getCloudProjectIdFromProjectTomlContents(projectToml)
  if (anyEnvironmentProjectId) {
    return {
      kind: 'other-environment',
      projectId: anyEnvironmentProjectId,
    }
  }

  return { kind: 'unbound' }
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

function cloudProjectDirectoryNameFromTitle(
  title: string | undefined,
  fallback: string
) {
  return title?.trim()
    ? getProjectDirectoryNameFromTitle(title, fallback)
    : fallback
}

function localProjectNameForRemoteProject(remoteProject: RemoteProject) {
  const fallback = sanitizeProjectName(remoteProject.id, 'cloud-project')
  return cloudProjectDirectoryNameFromTitle(remoteProject.title, fallback)
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

function assertReviewedRemoteRevision(
  currentRemoteRevision: Revision | undefined,
  reviewedRemoteRevision: Revision | undefined
) {
  if (
    reviewedRemoteRevision !== undefined &&
    currentRemoteRevision !== reviewedRemoteRevision
  ) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new CloudSyncConflictRevisionChangedError()
  }
}

async function downloadRemoteProjectSnapshot({
  projectId,
  remoteProject,
  reviewedRemoteRevision,
  verifyStableRevision = false,
}: {
  projectId: string
  remoteProject?: RemoteProject
  reviewedRemoteRevision?: Revision
  verifyStableRevision?: boolean
}) {
  const project = remoteProject ?? (await getRemoteProject(config, projectId))
  const revision = getRevision(project)
  assertReviewedRemoteRevision(revision, reviewedRemoteRevision)

  const parsedArchive = await parseProjectArchive(
    await downloadRemoteProjectArchive(config, projectId)
  )
  const filesWithMetadata = withRemoteProjectMetadataInArchiveFiles(
    parsedArchive,
    project.title,
    projectId,
    getEnvironmentName()
  )
  const files = filterCloudSyncProjectFilesForSync(filesWithMetadata)

  if (!verifyStableRevision) {
    return {
      project,
      files,
      revision,
      updatedAt: getRemoteUpdatedAt(project),
    }
  }

  const latestProject = await getRemoteProject(config, projectId)
  const latestRevision = getRevision(latestProject)
  assertReviewedRemoteRevision(latestRevision, revision)

  return {
    project: latestProject,
    files,
    revision: latestRevision,
    updatedAt: getRemoteUpdatedAt(latestProject),
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

type CloudProjectDirectoryNameSyncCandidate = {
  path: string
  name: string
  title?: string
  readWriteAccess?: boolean
}

function projectsByDirectory(
  projects: readonly CloudProjectDirectoryNameSyncCandidate[]
) {
  const projectsByDirectoryPath = new Map<
    string,
    CloudProjectDirectoryNameSyncCandidate[]
  >()
  for (const project of projects) {
    const projectDirectoryPath = localFs.dirname(project.path)
    projectsByDirectoryPath.set(projectDirectoryPath, [
      ...(projectsByDirectoryPath.get(projectDirectoryPath) ?? []),
      project,
    ])
  }

  return projectsByDirectoryPath
}

async function syncCloudProjectDirectoryNameFromTitle({
  metadata,
  title,
  pendingProjectPaths,
}: {
  metadata: ProjectMetadata
  title?: string
  pendingProjectPaths: ReadonlySet<string>
}) {
  const sourceProjectPath = normalizePathForSync(metadata.localProjectPath)
  if (
    !metadata.remoteProjectId ||
    metadata.tombstone ||
    isProjectSyncExcluded(metadata) ||
    pendingProjectPaths.has(sourceProjectPath) ||
    !(await exists(sourceProjectPath))
  ) {
    return metadata
  }

  const projectTitle =
    title?.trim() || (await readLocalProjectTitle(sourceProjectPath))
  if (!projectTitle?.trim()) {
    return metadata
  }

  const currentProjectName = projectNameFromPath(sourceProjectPath)
  const preferredProjectName = cloudProjectDirectoryNameFromTitle(
    projectTitle,
    currentProjectName
  )
  if (preferredProjectName === currentProjectName) {
    if (metadata.projectName === currentProjectName) {
      return metadata
    }

    const nextMetadata = {
      ...metadata,
      localProjectPath: sourceProjectPath,
      projectName: currentProjectName,
    }
    await putProjectMetadata(nextMetadata)
    return nextMetadata
  }

  const targetProjectPath = normalizePathForSync(
    await uniqueUnixProjectPath(
      localFs.dirname(sourceProjectPath),
      preferredProjectName,
      sourceProjectPath
    )
  )
  if (targetProjectPath === sourceProjectPath) {
    return metadata
  }

  await localFs.rename(sourceProjectPath, targetProjectPath)
  const nextMetadata = {
    ...metadata,
    localProjectPath: targetProjectPath,
    projectName: projectNameFromPath(targetProjectPath),
    tombstone: false,
  }
  await deleteProjectMetadata(sourceProjectPath)
  await putProjectMetadata(nextMetadata)

  if (normalizePathForSync(syncScopeProjectPath ?? '') === sourceProjectPath) {
    syncScopeProjectPath = targetProjectPath
  }
  if (
    normalizePathForSync(cloudSyncStatus.value.activeProjectPath ?? '') ===
    sourceProjectPath
  ) {
    updateStatus({ activeProjectPath: targetProjectPath })
  }

  return nextMetadata
}

export function scheduleCloudProjectDirectoryNameSyncFromTitles({
  projects,
  onProjectDirectoriesRenamed,
}: {
  projects: readonly CloudProjectDirectoryNameSyncCandidate[]
  onProjectDirectoriesRenamed?: () => void
}) {
  if (!isConfiguredForCloud()) {
    return
  }

  const syncGroups = Array.from(projectsByDirectory(projects)).filter(
    ([projectDirectoryPath]) => {
      if (scheduledProjectDirectoryNameSyncs.has(projectDirectoryPath)) {
        return false
      }

      scheduledProjectDirectoryNameSyncs.add(projectDirectoryPath)
      return true
    }
  )

  if (syncGroups.length === 0) {
    return
  }

  queueMicrotask(() => {
    void (async () => {
      let renamed = false
      const pendingProjectPaths = new Set(
        (await getAllOutboxEntries()).map((entry) =>
          normalizePathForSync(entry.projectPath)
        )
      )

      for (const [, directoryProjects] of syncGroups) {
        for (const project of directoryProjects) {
          if (!project.readWriteAccess) {
            continue
          }

          try {
            const metadata = await getProjectMetadata(project.path)
            if (!metadata) {
              continue
            }

            const nextMetadata = await syncCloudProjectDirectoryNameFromTitle({
              metadata,
              title: project.title,
              pendingProjectPaths,
            })
            if (
              normalizePathForSync(nextMetadata.localProjectPath) !==
              normalizePathForSync(metadata.localProjectPath)
            ) {
              renamed = true
            }
          } catch (error) {
            reportRejection(error)
          }
        }
      }

      if (renamed) {
        onProjectDirectoriesRenamed?.()
      }
    })()
      .catch(reportRejection)
      .finally(() => {
        for (const [projectDirectoryPath] of syncGroups) {
          scheduledProjectDirectoryNameSyncs.delete(projectDirectoryPath)
        }
      })
  })
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

async function clearOutboxEntriesTouchingProject(projectPath: string) {
  await clearSyncDbOutboxEntriesTouchingProject(projectPath)
  await refreshPendingCount()
}

async function refreshPendingCount() {
  try {
    const entries = await getAllOutboxEntries()
    updateStatus({
      pendingCount: getCloudSyncScopePlanForScope(
        entries,
        syncScopeProjectPath
          ? {
              projectPath: syncScopeProjectPath,
              syncable: syncScopeSyncable,
            }
          : undefined
      ).pendingCount,
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

async function isExistingDirectory(targetPath: string) {
  try {
    return statIsDirectory(await localFs.stat(targetPath))
  } catch {
    return false
  }
}

async function collectLocalProjectFiles(projectRoot: string) {
  const files: ProjectArchiveFile[] = []

  const walk = async (
    currentPath: string,
    gitignoreStack: GitignoreStackEntry[]
  ) => {
    const entries = await localFs.readdir(currentPath)
    for (const entry of entries) {
      if (isCloudSyncExcludedPath(entry)) {
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
  return normalizeProjectArchiveFilesForCloudSync(files).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  )
}

function getRemoteProjectEntrypointPath(remoteProject: RemoteProject) {
  const candidates = [
    remoteProject.entrypoint_path,
    remoteProject.entrypointPath,
    remoteProject.entrypoint,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeRelativePath(candidate)
    }
  }
  return undefined
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

async function uniqueUnixProjectPath(
  projectDirectory: string,
  projectName: string,
  ignoredProjectPath?: string
) {
  const ignored = ignoredProjectPath
    ? normalizePathForSync(ignoredProjectPath)
    : undefined
  let index = 0

  while (true) {
    const candidateName = index === 0 ? projectName : `${projectName}-${index}`
    const candidate = localFs.join(projectDirectory, candidateName)
    if (
      normalizePathForSync(candidate) === ignored ||
      !(await exists(candidate))
    ) {
      return candidate
    }
    index += 1
  }
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
  return (
    await findLocalProjectPathsByRemoteProjectId(
      projectDirectory,
      remoteProjectId,
      preferredProjectName
    )
  )[0]
}

async function findLocalProjectPathsByRemoteProjectId(
  projectDirectory: string,
  remoteProjectId: string,
  preferredProjectName?: string
) {
  const candidateNames = new Set<string>()
  if (preferredProjectName) {
    candidateNames.add(preferredProjectName)
  }
  const projectPaths: string[] = []

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
    const candidateMetadata = await getProjectMetadata(candidatePath)
    if (isProjectSyncExcluded(candidateMetadata)) {
      continue
    }
    const candidateRemoteProjectId = await readProjectTomlCloudProjectId(
      candidatePath
    ).catch(() => undefined)
    if (candidateRemoteProjectId === remoteProjectId) {
      projectPaths.push(normalizePathForSync(candidatePath))
    }
  }

  return projectPaths
}

type LocalProjectRealizationCandidate = {
  projectPath: string
  metadata?: ProjectMetadata
  manifest?: ProjectManifest
}

async function localProjectRealizationCandidate(
  projectPath: string
): Promise<LocalProjectRealizationCandidate> {
  return {
    projectPath,
    metadata: await getProjectMetadata(projectPath),
    manifest: await collectLocalProjectFiles(projectPath)
      .then(projectManifestFromFiles)
      .catch(() => undefined),
  }
}

async function getLocalProjectRealizationCandidatesByRemoteProjectId(
  projectDirectory: string,
  remoteProjectId: string,
  preferredProjectName?: string
): Promise<LocalProjectRealizationCandidate[]> {
  const paths = await findLocalProjectPathsByRemoteProjectId(
    projectDirectory,
    remoteProjectId,
    preferredProjectName
  )

  return Promise.all(paths.map(localProjectRealizationCandidate))
}

function canDeleteDuplicateLocalRealization({
  candidate,
  baseManifest,
  pendingProjectPaths,
}: {
  candidate: LocalProjectRealizationCandidate
  baseManifest: ProjectManifest
  pendingProjectPaths: ReadonlySet<string>
}) {
  const normalizedProjectPath = normalizePathForSync(candidate.projectPath)
  return Boolean(
    candidate.manifest &&
      !pendingProjectPaths.has(normalizedProjectPath) &&
      !candidate.metadata?.tombstone &&
      !candidate.metadata?.conflict &&
      !isProjectSyncExcluded(candidate.metadata) &&
      projectManifestsEqual(candidate.manifest, baseManifest)
  )
}

async function deleteLocalProjectRealization(projectPath: string) {
  await clearOutboxEntriesForProject(projectPath)
  if (await exists(projectPath)) {
    await localFs.rm(projectPath, { recursive: true })
  }
  await deleteProjectMetadata(projectPath)
}

async function detachLocalProjectRealization(projectPath: string) {
  await clearOutboxEntriesForProject(projectPath)
  if (await exists(projectPath).catch(() => false)) {
    await removeLocalProjectCloudProjectId(projectPath)
  }
  await deleteProjectMetadata(projectPath)
}

async function cleanupDuplicateLocalRealizationsForRemoteProject({
  remoteProjectId,
  projectDirectory,
  keepProjectPath,
}: {
  remoteProjectId: string
  projectDirectory: string
  keepProjectPath: string
}) {
  const normalizedKeepProjectPath = normalizePathForSync(keepProjectPath)
  const pendingProjectPaths = new Set(
    (await getAllOutboxEntries()).map((entry) =>
      normalizePathForSync(entry.projectPath)
    )
  )
  const candidates =
    await getLocalProjectRealizationCandidatesByRemoteProjectId(
      projectDirectory,
      remoteProjectId
    )
  const keepCandidate = candidates.find(
    (candidate) =>
      normalizePathForSync(candidate.projectPath) === normalizedKeepProjectPath
  )

  if (
    !keepCandidate?.metadata?.baseManifest ||
    !keepCandidate.manifest ||
    !projectManifestsEqual(
      keepCandidate.manifest,
      keepCandidate.metadata.baseManifest
    )
  ) {
    return []
  }

  const deletedProjectPaths: string[] = []
  for (const candidate of candidates) {
    const normalizedProjectPath = normalizePathForSync(candidate.projectPath)
    if (normalizedProjectPath === normalizedKeepProjectPath) {
      continue
    }
    if (
      !canDeleteDuplicateLocalRealization({
        candidate,
        baseManifest: keepCandidate.manifest,
        pendingProjectPaths,
      })
    ) {
      continue
    }

    await deleteLocalProjectRealization(candidate.projectPath)
    deletedProjectPaths.push(candidate.projectPath)
  }

  return deletedProjectPaths
}

export async function deleteCloudSyncLocalProjectRealizations(
  remoteProjectId: string,
  selectedProjectPath: string
) {
  if (!isConfiguredForCloud()) {
    return
  }

  const projectId = remoteProjectId.trim()
  const normalizedSelectedProjectPath =
    normalizePathForSync(selectedProjectPath)
  if (!projectId || !normalizedSelectedProjectPath) {
    return
  }

  const pendingProjectPaths = new Set(
    (await getAllOutboxEntries()).map((entry) =>
      normalizePathForSync(entry.projectPath)
    )
  )
  const projectDirectory = localFs.dirname(normalizedSelectedProjectPath)
  const candidates =
    await getLocalProjectRealizationCandidatesByRemoteProjectId(
      projectDirectory,
      projectId
    )
  let selectedCandidate = candidates.find(
    (candidate) =>
      normalizePathForSync(candidate.projectPath) ===
      normalizedSelectedProjectPath
  )
  if (
    !selectedCandidate &&
    (await exists(normalizedSelectedProjectPath).catch(() => false))
  ) {
    selectedCandidate = await localProjectRealizationCandidate(
      normalizedSelectedProjectPath
    )
    candidates.unshift(selectedCandidate)
  }
  const selectedManifest = selectedCandidate?.manifest

  for (const candidate of candidates) {
    const normalizedProjectPath = normalizePathForSync(candidate.projectPath)
    if (normalizedProjectPath === normalizedSelectedProjectPath) {
      await deleteLocalProjectRealization(candidate.projectPath)
      continue
    }

    if (
      selectedManifest &&
      canDeleteDuplicateLocalRealization({
        candidate,
        baseManifest: selectedManifest,
        pendingProjectPaths,
      })
    ) {
      await deleteLocalProjectRealization(candidate.projectPath)
      continue
    }

    await detachLocalProjectRealization(candidate.projectPath)
  }

  await refreshPendingCount()
}

export async function deleteCloudSyncDuplicateProjectRealizations({
  remoteProjectId,
  canonicalProjectPath,
  duplicateProjectPaths,
}: {
  remoteProjectId: string
  canonicalProjectPath?: string
  duplicateProjectPaths: readonly string[]
}) {
  if (!isConfiguredForCloud()) {
    return
  }

  const projectId = remoteProjectId.trim()
  const normalizedCanonicalProjectPath = canonicalProjectPath
    ? normalizePathForSync(canonicalProjectPath)
    : undefined
  if (!projectId) {
    return
  }

  const selectedProjectPaths = Array.from(
    new Set(duplicateProjectPaths.map(normalizePathForSync).filter(Boolean))
  )

  for (const projectPath of selectedProjectPaths) {
    if (projectPath === normalizedCanonicalProjectPath) {
      continue
    }

    const metadata = await getProjectMetadata(projectPath)
    const projectTomlCloudProjectId = await readProjectTomlCloudProjectId(
      projectPath
    ).catch(() => undefined)
    if (
      metadata?.remoteProjectId !== projectId &&
      projectTomlCloudProjectId !== projectId
    ) {
      continue
    }

    await deleteLocalProjectRealization(projectPath)
  }

  await refreshPendingCount()
}

async function cloneRemoteProjectToLocal(
  remoteProject: RemoteProject,
  projectDirectory: string,
  preferredProjectPath?: string
): Promise<CloudSyncLocalProject> {
  await localFs.mkdir(projectDirectory, { recursive: true })
  const projectName = localProjectNameForRemoteProject(remoteProject)
  const projectPath =
    preferredProjectPath && !(await exists(preferredProjectPath))
      ? preferredProjectPath
      : await uniqueProjectPath(projectDirectory, projectName)
  const archive = await downloadRemoteProjectArchive(config, remoteProject.id)
  const files = filterCloudSyncProjectFilesForSync(
    withRemoteProjectMetadataInArchiveFiles(
      await parseProjectArchive(archive),
      remoteProject.title,
      remoteProject.id,
      getEnvironmentName()
    )
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

export async function ensureCloudProjectLocallySynced(
  remoteProjectId: string,
  targetProjectDirectoryPath?: string
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
  // The destination directory is the local materialization path of the project
  // library the caller is opening this remote project from (e.g. the Personal
  // Cloud library).
  const projectDirectory = targetProjectDirectoryPath?.trim()
    ? normalizePathForSync(targetProjectDirectoryPath)
    : undefined
  if (!projectDirectory) {
    return undefined
  }
  const knownLocalProjectPath = knownLocalMetadata
    ? projectPathInDirectory(knownLocalMetadata, projectDirectory)
    : undefined
  if (
    knownLocalMetadata &&
    knownLocalProjectPath &&
    (await exists(knownLocalProjectPath))
  ) {
    let nextMetadata = knownLocalMetadata
    if (!(await readLocalProjectTitle(knownLocalProjectPath))) {
      const remoteProject = await getRemoteProject(config, projectId)
      nextMetadata = await hydrateCleanLocalProjectTitle(
        knownLocalMetadata,
        getRemoteProjectTitleForProjectToml(remoteProject.title)
      )
    }
    const metadataBeforeDirectorySync = nextMetadata
    nextMetadata = await syncCloudProjectDirectoryNameFromTitle({
      metadata: nextMetadata,
      title: await readLocalProjectTitle(nextMetadata.localProjectPath),
      pendingProjectPaths: new Set(),
    })
    if (
      nextMetadata !== knownLocalMetadata ||
      normalizePathForSync(nextMetadata.localProjectPath) !==
        normalizePathForSync(metadataBeforeDirectorySync.localProjectPath)
    ) {
      await cleanupDuplicateLocalRealizationsForRemoteProject({
        remoteProjectId: projectId,
        projectDirectory,
        keepProjectPath: nextMetadata.localProjectPath,
      })
      scheduleSync(0)
      return localProjectFromMetadata(nextMetadata)
    }
    await cleanupDuplicateLocalRealizationsForRemoteProject({
      remoteProjectId: projectId,
      projectDirectory,
      keepProjectPath: knownLocalMetadata.localProjectPath,
    })
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
    let nextMetadata: ProjectMetadata = {
      ...(await getOrCreateProjectMetadata(existingProjectPath)),
      remoteProjectId: projectId,
      tombstone: false,
    }
    await ensureLocalProjectTitle(
      existingProjectPath,
      getRemoteProjectTitleForProjectToml(remoteProject.title)
    )
    await putProjectMetadata(nextMetadata)
    nextMetadata = await syncCloudProjectDirectoryNameFromTitle({
      metadata: nextMetadata,
      title: await readLocalProjectTitle(nextMetadata.localProjectPath),
      pendingProjectPaths: new Set(),
    })
    await cleanupDuplicateLocalRealizationsForRemoteProject({
      remoteProjectId: projectId,
      projectDirectory,
      keepProjectPath: nextMetadata.localProjectPath,
    })
    scheduleSync(0)
    return localProjectFromMetadata(nextMetadata)
  }

  return cloneRemoteProjectToLocal(
    remoteProject,
    projectDirectory,
    knownLocalProjectPath
  )
}

/**
 * Rename the remote cloud project identified by `remoteProjectId`.
 *
 * This targets *remote-only* projects that have not been materialized locally,
 * so there is no local `project.toml` to edit. The cloud API has no title-only
 * update, so the whole-project archive is downloaded and re-uploaded with the
 * new title. Callers that own a local materialization should edit the local
 * `project.toml` instead and let sync replicate the rename to the remote.
 */
export async function renameRemoteCloudProject(
  remoteProjectId: string,
  requestedName: string
): Promise<void> {
  if (!isConfiguredForCloud()) {
    return
  }

  const projectId = remoteProjectId.trim()
  const title = requestedName.trim()
  if (!projectId || !title) {
    return
  }

  const remoteProject = await getRemoteProject(config, projectId)
  const files = withRemoteProjectMetadataInArchiveFiles(
    filterCloudSyncProjectFilesForSync(
      await parseProjectArchive(
        await downloadRemoteProjectArchive(config, projectId)
      )
    ),
    title,
    projectId,
    getEnvironmentName()
  )
  const updated = await updateRemoteProject({
    config,
    projectPath: localProjectNameForRemoteProject(remoteProject),
    project: remoteProject,
    files,
    expectedRevision: getRevision(remoteProject),
    entrypointPath: getRemoteProjectEntrypointPath(remoteProject),
  }).catch(rejectRemoteUploadFailure)

  // Reflect the new title in the in-memory remote index immediately so Home
  // updates before the next full remote index sync completes.
  cloudSyncRemoteProjects.value = cloudSyncRemoteProjects.value.map(
    (project) =>
      project.id === projectId
        ? { ...project, title: updated.title ?? title }
        : project
  )
  scheduleRemoteIndexSync(0)
}

function getRemoteDuplicateProjectTitle(sourceTitle: string) {
  return getUniqueDuplicateProjectName(
    sourceTitle,
    cloudSyncRemoteProjects.value.flatMap((project) => {
      const title = project.title?.trim()
      return title ? [title] : []
    })
  )
}

function prepareRemoteProjectFilesForDuplication(
  files: ProjectArchiveFile[],
  title: string
) {
  return withUpdatedProjectTomlInArchiveFiles(files, (projectToml) =>
    prepareProjectTomlForDuplication(projectToml, title, v4())
  )
}

/**
 * Duplicate a remote-only cloud project without creating a local
 * materialization. The copied archive receives a new project UUID and has its
 * source cloud binding removed before it is uploaded as a new cloud project.
 */
export async function duplicateRemoteCloudProject(
  remoteProjectId: string,
  requestedTitle: string
) {
  if (!isConfiguredForCloud()) {
    return undefined
  }

  const projectId = remoteProjectId.trim()
  if (!projectId) {
    return undefined
  }

  const sourceTitle = getRemoteProjectTitleForProjectToml(requestedTitle)
  const title = getRemoteDuplicateProjectTitle(sourceTitle)
  const files = prepareRemoteProjectFilesForDuplication(
    filterCloudSyncProjectFilesForSync(
      await parseProjectArchive(
        await downloadRemoteProjectArchive(config, projectId)
      )
    ),
    title
  )
  if (isErr(files)) {
    return Promise.reject(files)
  }

  const created = await createRemoteProject(config, title, files)
  const duplicatedProject = {
    ...created,
    title: created.title?.trim() || title,
  }
  cloudSyncRemoteProjects.value = [
    ...cloudSyncRemoteProjects.value.filter(
      (project) => project.id !== duplicatedProject.id
    ),
    duplicatedProject,
  ]
  scheduleRemoteIndexSync(0)

  return {
    id: duplicatedProject.id,
    title: duplicatedProject.title,
  }
}

/**
 * Delete the remote cloud project identified by `remoteProjectId`, tolerating a
 * remote that is already gone (404). Any local sync metadata still pointing at
 * it is cleared so the project neither reappears nor lingers as a tombstone.
 *
 * This targets the remote side of a user-visible delete. Callers that own a
 * local materialization must remove the local project as well before reporting
 * success.
 */
export async function deleteRemoteCloudProject(
  remoteProjectId: string
): Promise<void> {
  if (!isConfiguredForCloud()) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('Cloud sync is not enabled.')
  }

  const projectId = remoteProjectId.trim()
  if (!projectId) {
    return
  }

  try {
    await deleteRemoteProject(config, projectId)
  } catch (error) {
    if (!(error instanceof CloudApiError && error.status === 404)) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw error
    }
  }

  for (const metadata of await getAllProjectMetadata()) {
    if (metadata.remoteProjectId === projectId) {
      await detachLocalProjectRealization(metadata.localProjectPath)
    }
  }

  cloudSyncRemoteProjects.value = cloudSyncRemoteProjects.value.filter(
    (project) => project.id !== projectId
  )
  scheduleRemoteIndexSync(0)
}

export async function getCloudSyncRemoteProjectThumbnailUrl(
  remoteProject: RemoteProjectSummary
) {
  if (!isConfiguredForCloud()) {
    return undefined
  }

  return getRemoteProjectThumbnailUrl(config, remoteProject)
}

async function readProjectTomlCloudEnvironmentBinding(
  projectPath: string
): Promise<ProjectTomlCloudEnvironmentBinding> {
  const projectTomlPath = localFs.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  if (!(await exists(projectTomlPath))) {
    return { kind: 'unbound' }
  }

  const projectToml = await localFs.readFile(projectTomlPath, {
    encoding: 'utf-8',
  })

  return getProjectTomlCloudEnvironmentBinding(projectToml)
}

async function readProjectTomlCloudProjectId(projectPath: string) {
  const binding = await readProjectTomlCloudEnvironmentBinding(projectPath)
  return binding.kind === 'current-environment' ? binding.projectId : undefined
}

async function isLocalProjectEligibleForCurrentCloudEnvironment(
  projectPath: string
) {
  const binding = await readProjectTomlCloudEnvironmentBinding(
    projectPath
  ).catch(() => ({ kind: 'unbound' }) as const)
  return binding.kind !== 'other-environment'
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

async function bindRemoteProjectIdFromToml(
  metadata: ProjectMetadata,
  binding?: ProjectTomlCloudEnvironmentBinding
) {
  if (isProjectSyncExcluded(metadata)) {
    return metadata
  }

  const cloudBinding =
    binding ??
    (await readProjectTomlCloudEnvironmentBinding(
      metadata.localProjectPath
    ).catch(() => ({ kind: 'unbound' }) as const))
  if (cloudBinding.kind !== 'current-environment') {
    return metadata
  }

  if (metadata.remoteProjectId === cloudBinding.projectId) {
    return metadata
  }

  const next = {
    ...metadata,
    remoteProjectId: cloudBinding.projectId,
  }
  await putProjectMetadata(next)
  publishScopedProjectCloudProjectId(next)
  return next
}

async function markProjectFailure(
  metadata: ProjectMetadata,
  error: unknown
): Promise<void> {
  const message = errorMessage(error)
  const kind = projectFailureKind(error)
  const next = {
    ...metadata,
    lastFailure: {
      message,
      at: nowIso(),
      kind,
    },
  }
  await putProjectMetadata(next)
  publishScopedProjectCloudProjectId(next)
  if (projectPathMatchesSyncScope(metadata.localProjectPath)) {
    updateStatus({
      state: 'failed',
      activeProjectPath: metadata.localProjectPath,
      lastFailure: message,
      lastFailureKind: kind,
      lastFailureAt: next.lastFailure.at,
    })
  }
}

function markCloudMetadataFailure(error: unknown) {
  if (!isConfiguredForCloud()) {
    return
  }

  reportCloudSyncFailure('mutation', error)
  initialLocalScanComplete = false
  updateStatus({
    enabled: true,
    state: 'failed',
    lastFailure: errorMessage(error),
    lastFailureAt: nowIso(),
  })
  scheduleSyncFailureRetry(error)
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
  const nextMetadata = {
    ...metadata,
    baseManifest,
    remoteRevision: remote?.revision ?? metadata.remoteRevision,
    remoteUpdatedAt: remote?.updatedAt ?? metadata.remoteUpdatedAt,
    tombstone: false,
    conflict: undefined,
    lastFailure: undefined,
    lastSyncedAt: syncedAt,
  }
  await putProjectMetadata(nextMetadata)
  publishScopedProjectCloudProjectId(nextMetadata)
  if (!projectPathMatchesSyncScope(metadata.localProjectPath)) {
    return
  }

  if (syncInProgress) {
    pendingStatusSyncedAt = syncedAt
    updateStatus({
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

async function deleteLegacyConflictCopy(
  conflict: ProjectMetadata['conflict'] | undefined
) {
  const conflictProjectPath = conflict?.conflictProjectPath
  if (!conflictProjectPath) {
    return
  }

  await clearOutboxEntriesTouchingProject(conflictProjectPath)
  await clearLegacyConflictCopyReferences(conflictProjectPath)
  await deleteProjectMetadata(conflictProjectPath)
  if (await exists(conflictProjectPath)) {
    await localFs.rm(conflictProjectPath, { recursive: true })
  }
}

async function applyCloudDataForConflict(
  metadata: ProjectMetadata,
  reviewedRemoteRevision?: Revision
) {
  const conflict = metadata.conflict
  if (!metadata.remoteProjectId || !conflict) {
    return
  }

  const remoteSnapshot = await downloadRemoteProjectSnapshot({
    projectId: metadata.remoteProjectId,
    reviewedRemoteRevision:
      reviewedRemoteRevision ??
      conflict.remoteRevision ??
      metadata.remoteRevision,
    verifyStableRevision: true,
  })
  const remoteManifest = await projectManifestFromFiles(remoteSnapshot.files)
  await replaceLocalProjectWithFiles(
    metadata.localProjectPath,
    remoteSnapshot.files
  )
  await clearOutboxEntriesForProject(metadata.localProjectPath)
  await deleteLegacyConflictCopy(conflict)
  await markProjectSynced(metadata, remoteManifest, {
    revision: remoteSnapshot.revision,
    updatedAt: remoteSnapshot.updatedAt,
  })
}

async function applyLocalDataForConflict(
  metadata: ProjectMetadata,
  reviewedRemoteRevision?: Revision
) {
  const conflict = metadata.conflict
  if (!metadata.remoteProjectId || !conflict) {
    return Promise.reject(
      new Error('Cloud conflict cannot be resolved without a remote project.')
    )
  }

  const expectedRevision =
    reviewedRemoteRevision ?? conflict.remoteRevision ?? metadata.remoteRevision
  const remoteProject = await getRemoteProject(config, metadata.remoteProjectId)
  assertReviewedRemoteRevision(getRevision(remoteProject), expectedRevision)

  const localFiles = await collectLocalProjectFiles(metadata.localProjectPath)
  const localManifest = await projectManifestFromFiles(localFiles)
  const remoteFiles = filterCloudSyncProjectFilesForSync(
    await parseProjectArchive(
      await downloadRemoteProjectArchive(config, metadata.remoteProjectId)
    )
  )
  const updated = await updateRemoteProject({
    config,
    projectPath: metadata.localProjectPath,
    project: remoteProject,
    files: localFiles,
    expectedRevision,
    entrypointPath: getRemoteProjectEntrypointPath(remoteProject),
    deletedPaths: getRemovedProjectFilePaths(remoteFiles, localFiles),
  }).catch(rejectRemoteUploadFailure)
  await clearOutboxEntriesForProject(metadata.localProjectPath)
  await deleteLegacyConflictCopy(conflict)
  await markProjectSynced(
    metadata,
    localManifest,
    remoteSyncMetadata(updated, { useNowAsUpdatedAtFallback: true })
  )
}

export async function loadCloudSyncProjectConflictInspection(
  projectPath: string
): Promise<ConflictInspection | Error> {
  if (!isConfiguredForCloud()) {
    return new Error('Cloud sync is not enabled.')
  }

  const metadata = await getProjectMetadata(projectPath)
  if (!metadata?.conflict) {
    return new Error('Cloud conflict metadata was not found for this project.')
  }
  if (!metadata.remoteProjectId) {
    return new Error(
      'Cloud conflict cannot be inspected without a remote project.'
    )
  }

  const remoteSnapshot = await downloadRemoteProjectSnapshot({
    projectId: metadata.remoteProjectId,
  })
  const nextConflict = {
    ...metadata.conflict,
    remoteRevision: remoteSnapshot.revision ?? metadata.conflict.remoteRevision,
    remoteUpdatedAt:
      remoteSnapshot.updatedAt ?? metadata.conflict.remoteUpdatedAt,
  }
  const nextMetadata: ProjectMetadata = {
    ...metadata,
    conflict: nextConflict,
  }
  if (
    nextConflict.remoteRevision !== metadata.conflict.remoteRevision ||
    nextConflict.remoteUpdatedAt !== metadata.conflict.remoteUpdatedAt
  ) {
    await putProjectMetadata(nextMetadata)
  }

  const cloudSavedAtMs = nextConflict.remoteUpdatedAt
    ? Date.parse(nextConflict.remoteUpdatedAt)
    : undefined
  return buildConflictInspectionFromCloudFiles({
    projectPath,
    metadata: nextMetadata,
    cloudFiles: remoteSnapshot.files,
    cloudSavedAtMs,
    fileSystem: localFs,
    remoteRevision: nextConflict.remoteRevision,
  })
}

export async function resolveCloudSyncProjectConflict(
  projectPath: string,
  resolution: CloudSyncConflictResolution,
  reviewedRemoteRevision?: Revision
) {
  const metadata = await getProjectMetadata(projectPath)
  if (!metadata?.conflict) {
    return
  }

  try {
    if (resolution === 'cloud') {
      await applyCloudDataForConflict(metadata, reviewedRemoteRevision)
    } else {
      await applyLocalDataForConflict(metadata, reviewedRemoteRevision)
    }
    await refreshPendingCount()
    scheduleSync(0)
  } catch (error) {
    if (!isCloudSyncConflictRevisionChangedError(error)) {
      reportCloudSyncFailure('conflict-resolution', error)
      await markProjectFailure(metadata, error)
    }
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw error
  }
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
  remoteUpdatedAt: string | undefined,
  manifests: {
    localManifest?: ProjectManifest
    remoteManifest?: ProjectManifest
  } = {}
) {
  const createdAt = nowIso()
  const existingConflict = metadata.conflict

  const nextMetadata = {
    ...metadata,
    remoteUpdatedAt: remoteUpdatedAt ?? metadata.remoteUpdatedAt,
    conflict: {
      remoteRevision,
      remoteUpdatedAt,
      createdAt: existingConflict?.createdAt ?? createdAt,
      ...(existingConflict?.conflictProjectPath
        ? { conflictProjectPath: existingConflict.conflictProjectPath }
        : {}),
    },
    lastFailure: {
      message: 'Cloud sync conflict: local and remote both changed.',
      at: createdAt,
    },
  }
  await putProjectMetadata(nextMetadata)
  publishScopedProjectCloudProjectId(nextMetadata)
  if (projectPathMatchesSyncScope(metadata.localProjectPath)) {
    updateStatus({
      state: 'conflict',
      activeProjectPath: metadata.localProjectPath,
      lastFailure: 'Cloud sync conflict: local and remote both changed.',
      lastFailureAt: createdAt,
    })
  }
  reportCloudSyncConflict({
    localProjectPath: metadata.localProjectPath,
    remoteProjectId: metadata.remoteProjectId,
    syncBaseRemoteRevision: metadata.remoteRevision,
    conflictRemoteRevision: remoteRevision,
    conflictRemoteUpdatedAt: remoteUpdatedAt,
    baseManifest: metadata.baseManifest,
    localManifest: manifests.localManifest,
    remoteManifest: manifests.remoteManifest,
    existingConflictCreatedAt: existingConflict?.createdAt,
    reportedAt: createdAt,
  })
}

function latestOutboxKind(entries: OutboxEntry[]) {
  return entries.toSorted((a, b) => (a.id ?? 0) - (b.id ?? 0)).at(-1)?.kind
}

function getOutboxDeletedPaths(
  entries: OutboxEntry[],
  uploadedFiles: ProjectArchiveFile[],
  currentPaths?: Iterable<string>
) {
  const uploadedPaths = new Set(
    uploadedFiles.map((file) => normalizeRelativePath(file.relativePath))
  )
  const currentPathSet = currentPaths
    ? new Set(Array.from(currentPaths, normalizeRelativePath))
    : undefined
  return Array.from(
    new Set(
      entries
        .flatMap((entry) => entry.deletedPaths ?? [])
        .map(normalizeRelativePath)
        .filter(
          (path) =>
            Boolean(path) &&
            !uploadedPaths.has(path) &&
            (!currentPathSet || currentPathSet.has(path))
        )
    )
  ).sort()
}

function getRemovedProjectFilePaths(
  previousFiles: ProjectArchiveFile[],
  nextFiles: ProjectArchiveFile[]
) {
  const nextPaths = new Set(
    nextFiles.map((file) => normalizeRelativePath(file.relativePath))
  )
  return previousFiles
    .map((file) => normalizeRelativePath(file.relativePath))
    .filter((path) => !nextPaths.has(path))
    .sort()
}

function projectManifestEntryEqual(
  left: ProjectManifest['files'][string] | undefined,
  right: ProjectManifest['files'][string] | undefined
) {
  if (!left || !right) {
    return left === right
  }

  return left.byteSize === right.byteSize && left.sha256 === right.sha256
}

function projectArchiveFileMap(files: ProjectArchiveFile[]) {
  const filesByPath = new Map<string, ProjectArchiveFile>()
  for (const file of files) {
    const relativePath = normalizeRelativePath(file.relativePath)
    filesByPath.set(relativePath, {
      ...file,
      relativePath,
    })
  }
  return filesByPath
}

/**
 * Builds a whole-project snapshot when local and remote changed independent
 * paths from the last synced base. This is intentionally file-level only: when
 * both sides changed the same path differently, the user-facing conflict flow
 * remains responsible for choosing the winner.
 */
export function getCloudSyncAutoReconciledProjectFiles({
  baseManifest,
  localFiles,
  localManifest,
  remoteFiles,
  remoteManifest,
}: {
  baseManifest: ProjectManifest
  localFiles: ProjectArchiveFile[]
  localManifest: ProjectManifest
  remoteFiles: ProjectArchiveFile[]
  remoteManifest: ProjectManifest
}) {
  const localFilesByPath = projectArchiveFileMap(localFiles)
  const remoteFilesByPath = projectArchiveFileMap(remoteFiles)
  const relativePaths = Array.from(
    new Set([
      ...Object.keys(baseManifest.files),
      ...Object.keys(localManifest.files),
      ...Object.keys(remoteManifest.files),
    ])
  ).sort((left, right) => left.localeCompare(right))
  const mergedFiles: ProjectArchiveFile[] = []

  for (const relativePath of relativePaths) {
    const baseEntry = baseManifest.files[relativePath]
    const localEntry = localManifest.files[relativePath]
    const remoteEntry = remoteManifest.files[relativePath]
    const localChanged = !projectManifestEntryEqual(localEntry, baseEntry)
    const remoteChanged = !projectManifestEntryEqual(remoteEntry, baseEntry)

    if (projectManifestEntryEqual(localEntry, remoteEntry)) {
      const file = localFilesByPath.get(relativePath)
      if (file) {
        mergedFiles.push(file)
      }
      continue
    }

    if (localChanged && remoteChanged) {
      return undefined
    }

    const selectedFile = remoteChanged
      ? remoteFilesByPath.get(relativePath)
      : localFilesByPath.get(relativePath)
    if (selectedFile) {
      mergedFiles.push(selectedFile)
    }
  }

  return mergedFiles
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
  | 'auto-reconcile'
  | 'mark-conflict'

export function getCloudSyncRemoteArchiveReconciliationAction({
  hasBaseManifest,
  localMatchesRemote,
  localClean,
  canAutoReconcile,
}: {
  hasBaseManifest: boolean
  localMatchesRemote: boolean
  localClean: boolean
  canAutoReconcile?: boolean
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
  if (canAutoReconcile) {
    return 'auto-reconcile'
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

async function syncDeletedProject(
  metadata: ProjectMetadata,
  throttleProjectApiRequest: CloudSyncProjectApiRequestThrottle = unthrottledCloudSyncProjectApiRequest
) {
  const remoteProjectId = metadata.remoteProjectId
  if (remoteProjectId) {
    try {
      await runCloudSyncProjectApiRequest(throttleProjectApiRequest, () =>
        deleteRemoteProject(config, remoteProjectId)
      )
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

async function syncProject(
  projectPath: string,
  entries: OutboxEntry[],
  throttleProjectApiRequest: CloudSyncProjectApiRequestThrottle = unthrottledCloudSyncProjectApiRequest
) {
  let metadata = await getOrCreateProjectMetadata(projectPath)
  if (isProjectSyncExcluded(metadata)) {
    await clearOutboxEntriesForProject(metadata.localProjectPath)
    return
  }
  const cloudBinding = await readProjectTomlCloudEnvironmentBinding(
    metadata.localProjectPath
  ).catch(() => ({ kind: 'unbound' }) as const)
  if (cloudBinding.kind === 'other-environment') {
    await clearOutboxEntriesForProject(metadata.localProjectPath)
    return
  }

  try {
    metadata = await bindRemoteProjectIdFromToml(metadata, cloudBinding)
    if (!shouldSyncCloudLibraryProject(metadata) && entries.length === 0) {
      return
    }
    if (projectPathMatchesSyncScope(metadata.localProjectPath)) {
      updateStatus({
        state: 'syncing',
        activeProjectPath: metadata.localProjectPath,
      })
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
      await syncDeletedProject(metadata, throttleProjectApiRequest)
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
      const remoteProjectId = metadata.remoteProjectId
      try {
        remoteProject = await runCloudSyncProjectApiRequest(
          throttleProjectApiRequest,
          () => getRemoteProject(config, remoteProjectId)
        )
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
    if (entries.length === 0) {
      metadata = await syncCloudProjectDirectoryNameFromTitle({
        metadata,
        title: await readLocalProjectTitle(metadata.localProjectPath),
        pendingProjectPaths: new Set(),
      })
    }
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

    if (
      entries.length === 0 &&
      metadata.remoteProjectId &&
      metadata.baseManifest &&
      localChanged
    ) {
      reportCloudSyncUntrackedLocalChanges({
        remoteProjectId: metadata.remoteProjectId,
        remoteRevision: metadata.remoteRevision,
        baseFileCount: Object.keys(metadata.baseManifest.files).length,
        localFileCount: Object.keys(localManifest.files).length,
      })
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
      const created = await runCloudSyncProjectApiRequest(
        throttleProjectApiRequest,
        () => createRemoteProject(config, metadata.localProjectPath, localFiles)
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
      const updated = await runCloudSyncProjectApiRequest(
        throttleProjectApiRequest,
        () =>
          updateRemoteProject({
            config,
            projectPath: metadata.localProjectPath,
            project: remoteProject,
            files: localFiles,
            expectedRevision: metadata.remoteRevision,
            entrypointPath: getRemoteProjectEntrypointPath(remoteProject),
            deletedPaths: getOutboxDeletedPaths(
              entries,
              localFiles,
              Object.keys(metadata.baseManifest?.files ?? {})
            ),
          })
      ).catch(rejectRemoteUploadFailure)
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        localManifest,
        remoteSyncMetadata(updated, { useNowAsUpdatedAtFallback: true })
      )
      return
    }

    const remoteArchive = await runCloudSyncProjectApiRequest(
      throttleProjectApiRequest,
      () => downloadRemoteProjectArchive(config, remoteProjectId)
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
    const localClean = Boolean(
      metadata.baseManifest &&
        projectManifestsEqual(localManifest, metadata.baseManifest)
    )
    const autoReconciledFiles =
      metadata.baseManifest &&
      remoteRevision &&
      !localMatchesRemote &&
      !localClean
        ? getCloudSyncAutoReconciledProjectFiles({
            baseManifest: metadata.baseManifest,
            localFiles,
            localManifest,
            remoteFiles,
            remoteManifest,
          })
        : undefined
    const reconciliationAction = getCloudSyncRemoteArchiveReconciliationAction({
      hasBaseManifest: Boolean(metadata.baseManifest),
      localMatchesRemote,
      localClean,
      canAutoReconcile: Boolean(autoReconciledFiles),
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

    if (reconciliationAction === 'auto-reconcile' && autoReconciledFiles) {
      const autoReconciledManifest =
        await projectManifestFromFiles(autoReconciledFiles)
      const updated = await runCloudSyncProjectApiRequest(
        throttleProjectApiRequest,
        () =>
          updateRemoteProject({
            config,
            projectPath: metadata.localProjectPath,
            project: remoteProject,
            files: autoReconciledFiles,
            expectedRevision: remoteRevision,
            deletedPaths: getOutboxDeletedPaths(
              entries,
              autoReconciledFiles,
              remoteFiles.map((file) => file.relativePath)
            ),
          })
      ).catch(rejectRemoteUploadFailure)
      await replaceLocalProjectWithFiles(
        metadata.localProjectPath,
        autoReconciledFiles
      )
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        autoReconciledManifest,
        remoteSyncMetadata(updated, { useNowAsUpdatedAtFallback: true })
      )
      return
    }

    await markProjectConflict(
      metadata,
      remoteRevision,
      getRemoteUpdatedAt(remoteProject),
      {
        localManifest,
        remoteManifest,
      }
    )
  } catch (error) {
    await markProjectFailure(metadata, error)
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw error
  }
}

async function syncRemoteIndex(
  throttleProjectApiRequest: CloudSyncProjectApiRequestThrottle = unthrottledCloudSyncProjectApiRequest
) {
  const now = Date.now()
  if (now - lastRemoteIndexSyncAt < REMOTE_INDEX_INTERVAL_MS) {
    return
  }

  const projectDirectories = getCloudLibraryMaterializationPaths()
  for (const projectDirectory of projectDirectories) {
    await localFs.mkdir(projectDirectory, { recursive: true })
  }

  const remoteProjects = await runCloudSyncProjectApiRequest(
    throttleProjectApiRequest,
    () => listRemoteProjects(config)
  )
  cloudSyncRemoteProjects.value = remoteProjects
  const remoteProjectIds = new Set(
    remoteProjects.map((remoteProject) => remoteProject.id).filter(Boolean)
  )
  let metadata: ProjectMetadata[] = []
  for (const entry of await getAllProjectMetadata()) {
    if (
      isProjectSyncExcluded(entry) ||
      !getOwningCloudLibraryMaterializationPath(entry.localProjectPath) ||
      !(await isLocalProjectEligibleForCurrentCloudEnvironment(
        entry.localProjectPath
      ))
    ) {
      continue
    }
    metadata.push(entry)
  }
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
      const nextMetadata = await reconcileMissingRemoteProject(localMetadata, {
        hasPendingLocalChanges: pendingProjectPaths.has(
          normalizePathForSync(localMetadata.localProjectPath)
        ),
      })
      if (nextMetadata) {
        upsertMetadata(nextMetadata)
      } else {
        removeMetadata(localMetadata.localProjectPath)
      }
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
      const knownLocalMetadata = metadata.find(
        (entry) =>
          entry.remoteProjectId === remoteProject.id &&
          getOwningCloudLibraryMaterializationPath(entry.localProjectPath)
      )
      const knownLocalAction = getCloudSyncRemoteIndexAction({
        hasRemoteProjectId: Boolean(remoteProject.id),
        isRemoteProjectTombstoned: false,
        hasKnownLocalMetadata: Boolean(knownLocalMetadata),
        hasMatchingLocalProject: false,
      })
      if (knownLocalAction === 'sync-known-local' && knownLocalMetadata) {
        const knownLocalProjectDirectory =
          getOwningCloudLibraryMaterializationPath(
            knownLocalMetadata.localProjectPath
          )
        if (!knownLocalProjectDirectory) {
          continue
        }

        const knownLocalProjectPath = projectPathInDirectory(
          knownLocalMetadata,
          knownLocalProjectDirectory
        )
        const knownLocalPathIsCurrent =
          knownLocalProjectPath && (await exists(knownLocalProjectPath))
        if (!knownLocalPathIsCurrent) {
          await deleteProjectMetadata(knownLocalMetadata.localProjectPath)
          metadata = metadata.filter((entry) => entry !== knownLocalMetadata)
          continue
        }

        const hasPendingLocalChanges = pendingProjectPaths.has(
          normalizePathForSync(knownLocalMetadata.localProjectPath)
        )
        let nextLocalMetadata = hasPendingLocalChanges
          ? knownLocalMetadata
          : await hydrateCleanLocalProjectTitle(
              knownLocalMetadata,
              remoteProject.title
            )
        if (!hasPendingLocalChanges) {
          nextLocalMetadata = await syncCloudProjectDirectoryNameFromTitle({
            metadata: nextLocalMetadata,
            title: await readLocalProjectTitle(
              nextLocalMetadata.localProjectPath
            ),
            pendingProjectPaths,
          })
          if (
            normalizePathForSync(nextLocalMetadata.localProjectPath) !==
            normalizePathForSync(knownLocalMetadata.localProjectPath)
          ) {
            removeMetadata(knownLocalMetadata.localProjectPath)
          }
        }
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
          continue
        }

        if (knownLocalRemoteIndexAction === 'sync-known-local') {
          await syncProject(
            nextLocalMetadata.localProjectPath,
            [],
            throttleProjectApiRequest
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
        const deletedDuplicateProjectPaths =
          await cleanupDuplicateLocalRealizationsForRemoteProject({
            remoteProjectId: remoteProject.id,
            projectDirectory: knownLocalProjectDirectory,
            keepProjectPath: nextLocalMetadata.localProjectPath,
          })
        for (const deletedProjectPath of deletedDuplicateProjectPaths) {
          removeMetadata(deletedProjectPath)
        }
        continue
      }

      const projectName = localProjectNameForRemoteProject(remoteProject)
      let existingProjectDirectory: string | undefined
      let existingProjectPath: string | undefined
      for (const projectDirectory of projectDirectories) {
        existingProjectPath = await findLocalProjectPathByRemoteProjectId(
          projectDirectory,
          remoteProject.id,
          projectName
        )
        if (existingProjectPath) {
          existingProjectDirectory = projectDirectory
          break
        }
      }
      if (existingProjectPath && existingProjectDirectory) {
        let nextMetadata: ProjectMetadata = {
          ...(await getOrCreateProjectMetadata(existingProjectPath)),
          remoteProjectId: remoteProject.id,
          remoteUpdatedAt: getRemoteUpdatedAt(remoteProject),
        }
        await ensureLocalProjectTitle(
          existingProjectPath,
          getRemoteProjectTitleForProjectToml(remoteProject.title)
        )
        await putProjectMetadata(nextMetadata)
        nextMetadata = await syncCloudProjectDirectoryNameFromTitle({
          metadata: nextMetadata,
          title: await readLocalProjectTitle(nextMetadata.localProjectPath),
          pendingProjectPaths,
        })
        if (
          normalizePathForSync(nextMetadata.localProjectPath) !==
          normalizePathForSync(existingProjectPath)
        ) {
          removeMetadata(existingProjectPath)
        }
        upsertMetadata(nextMetadata)
        await syncProject(
          nextMetadata.localProjectPath,
          [],
          throttleProjectApiRequest
        )
        const syncedMetadata = await getProjectMetadata(existingProjectPath)
        const nextSyncedMetadata =
          syncedMetadata ??
          (await getProjectMetadata(nextMetadata.localProjectPath))
        if (nextSyncedMetadata) {
          upsertMetadata(nextSyncedMetadata)
          const deletedDuplicateProjectPaths =
            await cleanupDuplicateLocalRealizationsForRemoteProject({
              remoteProjectId: remoteProject.id,
              projectDirectory: existingProjectDirectory,
              keepProjectPath: nextSyncedMetadata.localProjectPath,
            })
          for (const deletedProjectPath of deletedDuplicateProjectPaths) {
            removeMetadata(deletedProjectPath)
          }
        }
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
        }: ${errorMessage(failures.at(-1))}`,
        { cause: failures.at(-1) }
      )
    )
  }

  lastRemoteIndexSyncAt = Date.now()
}

async function enqueueExistingCloudLibraryProjectsForInitialSync() {
  if (initialLocalScanComplete) {
    return
  }

  if (config.autoEnrollCloudLibraryProjects === false) {
    initialLocalScanComplete = true
    return
  }

  for (const projectDirectory of getCloudLibraryMaterializationPaths()) {
    if (!(await exists(projectDirectory))) {
      continue
    }

    const entries = await localFs.readdir(projectDirectory)
    for (const entry of entries) {
      if (entry.startsWith('.')) {
        continue
      }
      const projectPath = localFs.join(projectDirectory, entry)
      if (!(await isExistingDirectory(projectPath))) {
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
      if (
        !(await isLocalProjectEligibleForCurrentCloudEnvironment(projectPath))
      ) {
        continue
      }

      await registerProjectMutation(projectPath, 'upsert', projectPath)
    }
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
  updateStatus({ enabled: true })
  const scopedProjectPath = syncScopeProjectPath
  const scopedScope = scopedProjectPath
    ? {
        projectPath: scopedProjectPath,
        syncable: syncScopeSyncable,
      }
    : undefined
  let remoteIndexFailed = false
  let remoteIndexFailureMessage: string | undefined
  let remoteIndexFailure: unknown
  let failureRetryScheduled = false

  try {
    let entries = await getAllOutboxEntries()
    let syncScopePlan = getCloudSyncScopePlanForScope(entries, scopedScope)
    let throttleProjectApiRequest = createCloudSyncProjectApiRequestThrottle({
      enabled: shouldThrottleCloudSyncProjectApiRequests({
        hasSyncScope: Boolean(scopedScope),
        projectCount: syncScopePlan.projectPaths.length,
      }),
    })
    if (syncScopePlan.shouldSyncRemoteIndex) {
      updateStatus({ state: 'syncing' })
      await enqueueExistingCloudLibraryProjectsForInitialSync()
      entries = await getAllOutboxEntries()
      syncScopePlan = getCloudSyncScopePlanForScope(entries, scopedScope)
      throttleProjectApiRequest = createCloudSyncProjectApiRequestThrottle({
        enabled: shouldThrottleCloudSyncProjectApiRequests({
          hasSyncScope: Boolean(scopedScope),
          projectCount: syncScopePlan.projectPaths.length,
        }),
      })
      await syncRemoteIndex(throttleProjectApiRequest).catch((error) => {
        remoteIndexFailed = true
        remoteIndexFailureMessage = errorMessage(error)
        remoteIndexFailure = error
        reportCloudSyncFailure('remote-index', error)
        updateStatus({
          state: 'failed',
          lastFailure: remoteIndexFailureMessage,
          lastFailureAt: nowIso(),
        })
      })

      entries = await getAllOutboxEntries()
      syncScopePlan = getCloudSyncScopePlanForScope(entries, scopedScope)
    }

    for (const projectPath of syncScopePlan.projectPaths) {
      await syncProject(
        projectPath,
        outboxEntriesForProject(entries, projectPath),
        throttleProjectApiRequest
      )
    }

    await refreshPendingCount()
    const syncedAt = pendingStatusSyncedAt
    if (syncedAt && cloudSyncStatus.value.state === 'conflict') {
      updateStatus({ lastSyncedAt: syncedAt })
    }
    if (cloudSyncStatus.value.state !== 'conflict' && remoteIndexFailed) {
      updateStatus({
        state: 'failed',
        activeProjectPath: undefined,
        lastFailure: remoteIndexFailureMessage,
        lastFailureAt: nowIso(),
        ...(syncedAt ? { lastSyncedAt: syncedAt } : {}),
      })
      scheduleSyncFailureRetry(
        remoteIndexFailure ?? new Error(remoteIndexFailureMessage)
      )
      failureRetryScheduled = true
    } else if (cloudSyncStatus.value.state !== 'conflict') {
      resetSyncRetryBackoff()
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
      shouldScheduleCloudSyncPendingWork({
        pendingCount: cloudSyncStatus.value.pendingCount,
        state: cloudSyncStatus.value.state,
        failureRetryScheduled,
      })
    ) {
      scheduleSync(SYNC_DEBOUNCE_MS)
    }
  } catch (error) {
    const syncedAt = pendingStatusSyncedAt
    const kind = projectFailureKind(error)
    reportCloudSyncFailure('sync', error)
    updateStatus({
      state: 'failed',
      lastFailure: errorMessage(error),
      lastFailureKind: kind,
      lastFailureAt: nowIso(),
      activeProjectPath: scopedScope?.syncable ? scopedProjectPath : undefined,
      ...(syncedAt ? { lastSyncedAt: syncedAt } : {}),
    })
    scheduleSyncFailureRetry(error)
    failureRetryScheduled = true
  } finally {
    syncInProgress = false
    pendingStatusSyncedAt = undefined
    if (
      shouldScheduleCloudSyncPendingWork({
        pendingCount: cloudSyncStatus.value.pendingCount,
        state: cloudSyncStatus.value.state,
        failureRetryScheduled,
      })
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

function scheduleSyncFailureRetry(error: unknown) {
  scheduleSync(nextSyncRetryDelayMs(error))
}

function scheduleRemoteIndexSync(delay = 0) {
  lastRemoteIndexSyncAt = 0
  scheduleSync(delay)
}

// With no opened project, Home syncs the full cloud index. App.openProject()
// passes ownership context so file-route status and retries stay project-local.
export function setCloudSyncOpenedProject(
  openedProject?: CloudSyncOpenedProject
) {
  openedProjectContext = openedProject
  const nextScope = normalizeCloudSyncOpenedProject(openedProject)
  const nextSyncScopeProjectPath = nextScope?.projectPath
  const nextSyncScopeSyncable = nextScope?.syncable ?? false
  if (
    syncScopeProjectPath === nextSyncScopeProjectPath &&
    syncScopeSyncable === nextSyncScopeSyncable
  ) {
    return
  }

  syncScopeProjectPath = nextSyncScopeProjectPath
  syncScopeSyncable = nextSyncScopeSyncable
  void refreshScopedProjectCloudProjectId(nextScope)
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

/**
 * User-initiated project enrollment. This bypasses the automatic enrollment
 * policy so local-only projects can be opted into cloud sync one at a time.
 */
export async function startCloudSyncProject(projectPath: string) {
  if (!isConfiguredForCloud()) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('Cloud sync is not enabled.')
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  const stat = await localFs.stat(normalizedProjectPath)
  if (!statIsDirectory(stat)) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('Cloud sync can only start from a project directory.')
  }

  const metadata = await bindRemoteProjectIdFromToml(
    await getOrCreateProjectMetadata(normalizedProjectPath)
  )

  await clearOutboxEntriesForProject(normalizedProjectPath)
  const nextMetadata = {
    ...metadata,
    localProjectPath: normalizedProjectPath,
    projectName: projectNameFromPath(normalizedProjectPath),
    tombstone: false,
    syncExcluded: undefined,
    conflict: undefined,
    lastFailure: undefined,
  }
  await putProjectMetadata(nextMetadata)
  publishScopedProjectCloudProjectId(nextMetadata)
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
 * User-initiated disconnect. Local metadata is detached before remote deletion
 * so a concurrent remote-index sync cannot mirror the remote delete into a
 * local directory delete.
 */
export async function disconnectCloudSyncProject(projectPath: string) {
  if (!isConfiguredForCloud()) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('Cloud sync is not enabled.')
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  const metadata = await bindRemoteProjectIdFromToml(
    await getOrCreateProjectMetadata(normalizedProjectPath)
  )
  const remoteProjectId = metadata.remoteProjectId
  const disconnectedAt = nowIso()

  await removeLocalProjectCloudProjectId(normalizedProjectPath)
  const disconnectedMetadata: ProjectMetadata = {
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
  }
  await putProjectMetadata(disconnectedMetadata)
  publishScopedProjectCloudProjectId(disconnectedMetadata)

  if (remoteProjectId) {
    try {
      await deleteRemoteProject(config, remoteProjectId)
    } catch (error) {
      if (!(error instanceof CloudApiError && error.status === 404)) {
        const restoredMetadata = {
          ...metadata,
          localProjectPath: normalizedProjectPath,
          projectName: projectNameFromPath(normalizedProjectPath),
          syncExcluded: undefined,
        }
        await putProjectMetadata(restoredMetadata)
        publishScopedProjectCloudProjectId(restoredMetadata)
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
  await putProjectMetadata(disconnectedMetadata)
  publishScopedProjectCloudProjectId(disconnectedMetadata)
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

function isCloudSyncGeneratedArtifactPath(relativePath: string) {
  return normalizeRelativePath(relativePath) === PROJECT_IMAGE_NAME
}

async function createGitignoreStackForMutationTarget(
  projectRoot: string,
  relativeTargetPath: string
) {
  let gitignoreStack = await createInitialGitignoreStackWithFs(
    localFs,
    projectRoot
  )
  const parentParts = webSafePathSplit(relativeTargetPath)
    .filter(Boolean)
    .slice(0, -1)
  let currentDirectory = projectRoot

  for (const part of parentParts) {
    currentDirectory = localFs.join(currentDirectory, part)
    gitignoreStack = await appendGitignoreForDirectoryWithFs(
      localFs,
      gitignoreStack,
      currentDirectory,
      projectRoot
    )
  }

  return gitignoreStack
}

async function isCloudSyncIgnoredMutationTarget(
  projectRoot: string,
  targetPath: string
) {
  const relativeTargetPath = normalizeRelativePath(
    localFs.relative(projectRoot, targetPath)
  )
  if (!relativeTargetPath) {
    return false
  }
  if (isCloudSyncGeneratedArtifactPath(relativeTargetPath)) {
    return true
  }

  const gitignoreStack = await createGitignoreStackForMutationTarget(
    projectRoot,
    relativeTargetPath
  )
  const stat = await localFs.stat(targetPath).catch(() => undefined)
  return isPathIgnoredByGitignore(
    gitignoreStack,
    relativeTargetPath,
    stat ? statIsDirectory(stat) : false
  )
}

async function registerProjectMutation(
  projectPath: string,
  kind: OutboxEntry['kind'],
  targetPath: string,
  sourcePath?: string,
  deletedPaths?: string[]
) {
  if (!isConfiguredForCloud() || isCloudSyncExcludedPath(targetPath)) {
    return
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  if (
    projectNameFromPath(normalizedProjectPath).startsWith(
      DUPLICATE_PROJECT_TEMPORARY_PREFIX
    )
  ) {
    return
  }
  const normalizedTargetPath = normalizePathForSync(targetPath)
  const existingMetadata = await getProjectMetadata(normalizedProjectPath)
  if (kind === 'delete') {
    if (
      !existingMetadata &&
      !(await isExistingDirectory(normalizedProjectPath))
    ) {
      return
    }
  } else if (!(await isExistingDirectory(normalizedProjectPath))) {
    return
  }

  if (
    await isCloudSyncIgnoredMutationTarget(
      normalizedProjectPath,
      normalizedTargetPath
    )
  ) {
    return
  }
  const cloudBinding = await readProjectTomlCloudEnvironmentBinding(
    normalizedProjectPath
  ).catch(() => ({ kind: 'unbound' }) as const)
  if (
    !existingMetadata &&
    !getOwningCloudLibraryMaterializationPath(normalizedProjectPath) &&
    cloudBinding.kind !== 'current-environment'
  ) {
    return
  }
  let metadata =
    existingMetadata ??
    (await getOrCreateProjectMetadata(normalizedProjectPath))
  if (isProjectSyncExcluded(metadata)) {
    await clearOutboxEntriesForProject(normalizedProjectPath)
    return
  }
  if (cloudBinding.kind === 'other-environment') {
    await clearOutboxEntriesForProject(normalizedProjectPath)
    return
  }
  metadata = await bindRemoteProjectIdFromToml(metadata, cloudBinding)
  if (!shouldSyncCloudLibraryProject(metadata)) {
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
    targetPath: normalizedTargetPath,
    sourcePath: sourcePath ? normalizePathForSync(sourcePath) : undefined,
    deletedPaths: deletedPaths?.length ? deletedPaths : undefined,
    createdAt: nowIso(),
  })
  scheduleSync()
}

async function registerProjectRename(sourcePath: string, targetPath: string) {
  if (!isConfiguredForCloud()) {
    return
  }

  const sourceProjectRoot = getSyncPolicyProjectRoot(sourcePath)
  const targetProjectRoot = getSyncPolicyProjectRoot(targetPath)
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
      if (isProjectSyncExcluded(sourceMetadata)) {
        return
      }
    }
  }

  const deletedPaths =
    sourceProjectRoot &&
    normalizePathForSync(sourceProjectRoot) ===
      normalizePathForSync(targetProjectRoot)
      ? await getObservedDeletedPaths(sourceProjectRoot, sourcePath)
      : undefined
  await registerProjectMutation(
    targetProjectRoot,
    'upsert',
    targetPath,
    sourcePath,
    deletedPaths
  )
}

async function afterWriteLikeMutation(targetPath: string) {
  const projectRoot = getSyncPolicyProjectRoot(targetPath)
  if (!projectRoot) {
    if (isCloudLibraryMaterializationPath(targetPath)) {
      scheduleSync()
    }
    return
  }

  await registerProjectMutation(projectRoot, 'upsert', targetPath)
}

async function afterRemoveMutation(targetPath: string) {
  const projectRoot = getSyncPolicyProjectRoot(targetPath)
  if (!projectRoot) {
    return
  }

  const deletingProject = isProjectRootPath(targetPath, projectRoot)
  await registerProjectMutation(
    projectRoot,
    deletingProject ? 'delete' : 'upsert',
    targetPath,
    undefined,
    deletingProject
      ? undefined
      : await getObservedDeletedPaths(projectRoot, targetPath)
  )
}

async function getObservedDeletedPaths(
  projectRoot: string,
  targetPath: string
) {
  const metadata = await getProjectMetadata(projectRoot)
  const relativeTargetPath = normalizeRelativePath(
    localFs.relative(projectRoot, targetPath)
  )
  if (!metadata?.baseManifest || !relativeTargetPath) {
    return []
  }

  return Object.keys(metadata.baseManifest.files)
    .filter(
      (path) =>
        path === relativeTargetPath || path.startsWith(`${relativeTargetPath}/`)
    )
    .sort()
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
    getCloudLibraryMaterializationConfigKey(previousConfig) !==
    getCloudLibraryMaterializationConfigKey(config)
  const autoEnrollPolicyChanged =
    previousConfig.autoEnrollCloudLibraryProjects !==
    config.autoEnrollCloudLibraryProjects
  if (
    cloudIdentityChanged ||
    projectDirectoryChanged ||
    autoEnrollPolicyChanged
  ) {
    lastRemoteIndexSyncAt = 0
    initialLocalScanComplete = false
    resetSyncRetryBackoff()
  }

  if (projectDirectoryChanged && openedProjectContext) {
    setCloudSyncOpenedProject(openedProjectContext)
  }

  if (!config.enabled) {
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = undefined
    }
    detachVisibilityChangeListener?.()
    initialLocalScanComplete = false
    lastRemoteIndexSyncAt = 0
    resetSyncRetryBackoff()
    cloudSyncRemoteProjects.value = []
    updateStatus({
      enabled: false,
      state: 'disabled',
      activeProjectPath: undefined,
      scopedProjectPath: undefined,
      scopedProjectCloudProjectId: undefined,
      lastFailure: undefined,
      lastFailureAt: undefined,
    })
    return
  }

  const shouldResetEnabledStatus =
    !previousConfig.enabled ||
    cloudIdentityChanged ||
    projectDirectoryChanged ||
    autoEnrollPolicyChanged ||
    cloudSyncStatus.value.state === 'disabled'

  attachVisibilityChangeListener()
  updateStatus({
    enabled: true,
    ...(shouldResetEnabledStatus
      ? {
          state: 'idle',
          activeProjectPath: undefined,
          lastFailure: undefined,
          lastFailureAt: undefined,
        }
      : {}),
  })
  void refreshScopedProjectCloudProjectId(
    syncScopeProjectPath
      ? {
          projectPath: syncScopeProjectPath,
          syncable: syncScopeSyncable,
        }
      : undefined
  )
  void refreshPendingCount()
  scheduleSync(0)
}

export function retryCloudSyncEngine() {
  resetSyncRetryBackoff()
  if (syncScopeProjectPath) {
    scheduleSync(0)
    return
  }

  scheduleRemoteIndexSync(0)
}
