import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { CloudApiError } from '@src/lib/cloudSync/cloudApi'
import type {
  OutboxEntry,
  ProjectManifest,
  Revision,
} from '@src/lib/cloudSync/types'
import { hashString } from '@src/lib/stringUtils'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'

const route = '/cloud-sync'
let clientInstanceId: string | undefined

export type CloudSyncFailureContext = {
  remoteProjectId?: string
  syncBaseRemoteRevision?: Revision
  observedRemoteRevision?: Revision
  baseManifest?: ProjectManifest
  localManifest?: ProjectManifest
  attemptOutboxEntries?: OutboxEntry[]
  currentOutboxEntries?: OutboxEntry[]
  replacementUploadFileCount?: number
  replacementUploadDeletedPathCount?: number
}

/**
 * Privacy boundary for cloud sync telemetry. Raw local project paths and file
 * names stay client-side; reports use opaque ids, hashes, and aggregate counts.
 */
type CloudSyncConflictReportParams = {
  localProjectPath?: string
  remoteProjectId?: string
  syncBaseRemoteRevision?: Revision
  conflictRemoteRevision?: Revision
  conflictRemoteUpdatedAt?: string
  baseManifest?: ProjectManifest
  localManifest?: ProjectManifest
  remoteManifest?: ProjectManifest
  existingConflictCreatedAt?: string
  reportedAt?: string
}

function submit(params: Parameters<typeof reportClientError>[0]) {
  void Promise.resolve(reportClientError(params)).catch(reportRejection)
}

function getClientInstanceId() {
  clientInstanceId ??=
    globalThis.crypto?.randomUUID?.() ??
    `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return clientInstanceId
}

function normalizeTelemetryPath(path: string) {
  return path.replaceAll('\\', '/').replace(/\/+$/g, '')
}

function getManifestFingerprint(manifest: ProjectManifest | undefined) {
  if (!manifest) {
    return undefined
  }

  return hashString(
    JSON.stringify(
      Object.entries(manifest.files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([relativePath, entry]) => [
          relativePath,
          entry.byteSize,
          entry.sha256,
        ])
    )
  )
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

function getConflictManifestSummary({
  baseManifest,
  localManifest,
  remoteManifest,
}: Pick<
  CloudSyncConflictReportParams,
  'baseManifest' | 'localManifest' | 'remoteManifest'
>) {
  if (!baseManifest || !localManifest || !remoteManifest) {
    return {}
  }

  const relativePaths = new Set([
    ...Object.keys(baseManifest.files),
    ...Object.keys(localManifest.files),
    ...Object.keys(remoteManifest.files),
  ])
  let localChangedFileCount = 0
  let remoteChangedFileCount = 0
  let overlappingChangedFileCount = 0
  let divergentChangedFileCount = 0

  for (const relativePath of relativePaths) {
    const baseEntry = baseManifest.files[relativePath]
    const localEntry = localManifest.files[relativePath]
    const remoteEntry = remoteManifest.files[relativePath]
    const localChanged = !projectManifestEntryEqual(localEntry, baseEntry)
    const remoteChanged = !projectManifestEntryEqual(remoteEntry, baseEntry)

    if (localChanged) {
      localChangedFileCount += 1
    }
    if (remoteChanged) {
      remoteChangedFileCount += 1
    }
    if (localChanged && remoteChanged) {
      overlappingChangedFileCount += 1
      if (!projectManifestEntryEqual(localEntry, remoteEntry)) {
        divergentChangedFileCount += 1
      }
    }
  }

  return {
    localChangedFileCount,
    remoteChangedFileCount,
    overlappingChangedFileCount,
    divergentChangedFileCount,
  }
}

function getCloudSyncConflictProjectIdentity({
  localProjectPath,
  remoteProjectId,
}: Pick<
  CloudSyncConflictReportParams,
  'localProjectPath' | 'remoteProjectId'
>) {
  const localProjectPathHash = localProjectPath
    ? hashString(normalizeTelemetryPath(localProjectPath))
    : undefined

  if (remoteProjectId) {
    return {
      projectIdentityKind: 'remote-project-id',
      projectIdentity: remoteProjectId,
      localProjectPathHash,
    }
  }

  if (localProjectPathHash) {
    return {
      projectIdentityKind: 'local-project-path-hash',
      projectIdentity: localProjectPathHash,
      localProjectPathHash,
    }
  }

  return {
    projectIdentityKind: undefined,
    projectIdentity: undefined,
    localProjectPathHash,
  }
}

function getConflictAgeMs({
  existingConflictCreatedAt,
  reportedAt,
}: Pick<
  CloudSyncConflictReportParams,
  'existingConflictCreatedAt' | 'reportedAt'
>) {
  if (!existingConflictCreatedAt) {
    return undefined
  }

  const ageMs =
    Date.parse(reportedAt ?? new Date().toISOString()) -
    Date.parse(existingConflictCreatedAt)
  return Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : undefined
}

type OutboxSummary = {
  entryCount: number
  upsertEntryCount: number
  deleteEntryCount: number
  entriesWithSourcePathCount: number
  entriesWithDeletedPathsCount: number
  declaredDeletedPathCount: number
  distinctDeletedPathCount: number
  invalidEntryCount: number
  invalidDeletedPathValueCount: number
  oldestEntryAgeBucket?: string
}

type CloudSyncFailureTelemetryContext = {
  contextSanitizationFailed?: boolean
  invalidRemoteProjectId?: boolean
  remoteProjectId?: string
  syncBaseRemoteRevisionPresent?: boolean
  observedRemoteRevisionPresent?: boolean
  remoteRevisionsMatch?: boolean
  invalidSyncBaseRemoteRevision?: boolean
  invalidObservedRemoteRevision?: boolean
  baseManifestFileCount?: number
  localManifestFileCount?: number
  replacementUploadFileCount?: number
  replacementUploadDeletedPathCount?: number
  attemptOutbox?: OutboxSnapshot
  currentOutbox?: OutboxSnapshot
}

type OutboxSnapshot =
  | { readSucceeded: false }
  | ({ readSucceeded: true } & OutboxSummary)

const cloudSyncFailureContexts = new WeakMap<
  object,
  CloudSyncFailureTelemetryContext
>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isArray(value)
}

function getOldestEntryAgeBucket(oldestCreatedAt: number | undefined) {
  if (oldestCreatedAt === undefined) {
    return undefined
  }

  const ageMs = Math.max(0, Date.now() - oldestCreatedAt)
  if (ageMs < 60_000) {
    return 'under-1-minute'
  }
  if (ageMs < 5 * 60_000) {
    return '1-to-5-minutes'
  }
  if (ageMs < 30 * 60_000) {
    return '5-to-30-minutes'
  }
  if (ageMs < 2 * 60 * 60_000) {
    return '30-minutes-to-2-hours'
  }
  if (ageMs < 24 * 60 * 60_000) {
    return '2-to-24-hours'
  }
  if (ageMs < 7 * 24 * 60 * 60_000) {
    return '1-to-7-days'
  }
  return 'over-7-days'
}

function getOutboxSummary(value: unknown): OutboxSummary {
  if (!isArray(value)) {
    return {
      entryCount: 0,
      upsertEntryCount: 0,
      deleteEntryCount: 0,
      entriesWithSourcePathCount: 0,
      entriesWithDeletedPathsCount: 0,
      declaredDeletedPathCount: 0,
      distinctDeletedPathCount: 0,
      invalidEntryCount: 1,
      invalidDeletedPathValueCount: 0,
    }
  }

  let upsertEntryCount = 0
  let deleteEntryCount = 0
  let entriesWithSourcePathCount = 0
  let entriesWithDeletedPathsCount = 0
  let declaredDeletedPathCount = 0
  let invalidEntryCount = 0
  let invalidDeletedPathValueCount = 0
  let oldestCreatedAt: number | undefined
  const distinctDeletedPaths = new Set<string>()

  for (const entry of value) {
    if (!isRecord(entry)) {
      invalidEntryCount += 1
      continue
    }

    if (entry.kind === 'upsert') {
      upsertEntryCount += 1
    } else if (entry.kind === 'delete') {
      deleteEntryCount += 1
    } else {
      invalidEntryCount += 1
    }

    if (typeof entry.sourcePath === 'string' && entry.sourcePath) {
      entriesWithSourcePathCount += 1
    }

    if (entry.deletedPaths !== undefined) {
      if (isArray(entry.deletedPaths)) {
        if (entry.deletedPaths.length) {
          entriesWithDeletedPathsCount += 1
        }
        declaredDeletedPathCount += entry.deletedPaths.length
        for (const path of entry.deletedPaths) {
          if (typeof path === 'string') {
            distinctDeletedPaths.add(normalizeTelemetryPath(path))
          } else {
            invalidDeletedPathValueCount += 1
          }
        }
      } else {
        invalidDeletedPathValueCount += 1
      }
    }

    if (typeof entry.createdAt === 'string') {
      const createdAt = Date.parse(entry.createdAt)
      if (
        Number.isFinite(createdAt) &&
        (oldestCreatedAt === undefined || createdAt < oldestCreatedAt)
      ) {
        oldestCreatedAt = createdAt
      }
    }
  }

  return {
    entryCount: value.length,
    upsertEntryCount,
    deleteEntryCount,
    entriesWithSourcePathCount,
    entriesWithDeletedPathsCount,
    declaredDeletedPathCount,
    distinctDeletedPathCount: distinctDeletedPaths.size,
    invalidEntryCount,
    invalidDeletedPathValueCount,
    oldestEntryAgeBucket: getOldestEntryAgeBucket(oldestCreatedAt),
  }
}

function getManifestFileCount(value: unknown) {
  if (!isRecord(value) || !isRecord(value.files)) {
    return undefined
  }
  return Object.keys(value.files).length
}

function getSafeCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

function getOutboxSnapshot(value: unknown): OutboxSnapshot {
  return value === undefined
    ? { readSucceeded: false }
    : { readSucceeded: true, ...getOutboxSummary(value) }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getRemoteProjectId(value: unknown) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? value
    : undefined
}

export function setCloudSyncFailureContext(
  error: unknown,
  context: CloudSyncFailureContext
) {
  const contextualError =
    error instanceof Error
      ? error
      : new Error(
          typeof error === 'string'
            ? error
            : 'Cloud sync failed with a non-Error value.',
          { cause: error }
        )

  try {
    const remoteProjectId = getRemoteProjectId(context.remoteProjectId)
    const syncBaseRemoteRevisionValid =
      typeof context.syncBaseRemoteRevision === 'string'
    const observedRemoteRevisionValid =
      typeof context.observedRemoteRevision === 'string'
    cloudSyncFailureContexts.set(contextualError, {
      remoteProjectId,
      invalidRemoteProjectId:
        context.remoteProjectId !== undefined && remoteProjectId === undefined,
      syncBaseRemoteRevisionPresent: syncBaseRemoteRevisionValid,
      observedRemoteRevisionPresent: observedRemoteRevisionValid,
      remoteRevisionsMatch:
        syncBaseRemoteRevisionValid && observedRemoteRevisionValid
          ? context.syncBaseRemoteRevision === context.observedRemoteRevision
          : undefined,
      invalidSyncBaseRemoteRevision:
        context.syncBaseRemoteRevision !== undefined &&
        !syncBaseRemoteRevisionValid,
      invalidObservedRemoteRevision:
        context.observedRemoteRevision !== undefined &&
        !observedRemoteRevisionValid,
      baseManifestFileCount: getManifestFileCount(context.baseManifest),
      localManifestFileCount: getManifestFileCount(context.localManifest),
      replacementUploadFileCount: getSafeCount(
        context.replacementUploadFileCount
      ),
      replacementUploadDeletedPathCount: getSafeCount(
        context.replacementUploadDeletedPathCount
      ),
      attemptOutbox: getOutboxSnapshot(context.attemptOutboxEntries),
      currentOutbox: getOutboxSnapshot(context.currentOutboxEntries),
    })
  } catch {
    cloudSyncFailureContexts.set(contextualError, {
      contextSanitizationFailed: true,
    })
  }

  return contextualError
}

function getCloudSyncFailureContext(error: unknown) {
  try {
    let current = error
    const visited = new Set<object>()

    while (typeof current === 'object' && current !== null) {
      if (visited.has(current)) {
        return undefined
      }
      visited.add(current)

      const context = cloudSyncFailureContexts.get(current)
      if (context) {
        return context
      }
      if (!(current instanceof Error) || current.cause === undefined) {
        return undefined
      }
      current = current.cause
    }
  } catch {
    return undefined
  }

  return undefined
}

function getCloudSyncConflictDedupeKey(params: CloudSyncConflictReportParams) {
  const { projectIdentity, projectIdentityKind } =
    getCloudSyncConflictProjectIdentity(params)
  if (!projectIdentity) {
    return undefined
  }

  return [
    'CloudSync',
    'conflict',
    projectIdentityKind ?? 'unknown',
    projectIdentity,
    params.syncBaseRemoteRevision ?? 'none',
    params.conflictRemoteRevision ?? 'none',
    getManifestFingerprint(params.baseManifest) ?? 'none',
    getManifestFingerprint(params.localManifest) ?? 'none',
    getManifestFingerprint(params.remoteManifest) ?? 'none',
  ].join(':')
}

export function reportCloudSyncConflict(
  params: CloudSyncConflictReportParams = {}
) {
  const projectIdentity = getCloudSyncConflictProjectIdentity(params)
  submit({
    code: ClientErrorCode.CloudSyncConflict,
    errorName: 'CloudSyncConflict',
    message: 'Cloud sync conflict: local and remote both changed.',
    route,
    dedupeKey: getCloudSyncConflictDedupeKey(params),
    extra: {
      source: 'CloudSyncEngine',
      operation: 'reconcile-project',
      clientInstanceId: getClientInstanceId(),
      ...projectIdentity,
      remoteProjectId: params.remoteProjectId,
      syncBaseRemoteRevision: params.syncBaseRemoteRevision,
      conflictRemoteRevision: params.conflictRemoteRevision,
      conflictRemoteUpdatedAt: params.conflictRemoteUpdatedAt,
      conflictAlreadyRecorded: Boolean(params.existingConflictCreatedAt),
      existingConflictAgeMs: getConflictAgeMs(params),
      baseManifestFingerprint: getManifestFingerprint(params.baseManifest),
      localManifestFingerprint: getManifestFingerprint(params.localManifest),
      remoteManifestFingerprint: getManifestFingerprint(params.remoteManifest),
      baseManifestFileCount: params.baseManifest
        ? Object.keys(params.baseManifest.files).length
        : undefined,
      localManifestFileCount: params.localManifest
        ? Object.keys(params.localManifest.files).length
        : undefined,
      remoteManifestFileCount: params.remoteManifest
        ? Object.keys(params.remoteManifest.files).length
        : undefined,
      ...getConflictManifestSummary(params),
    },
  })
}

export function reportCloudSyncConflictCopyDetected() {
  submit({
    code: ClientErrorCode.CloudSyncConflictCopyDetected,
    errorName: 'CloudSyncConflictCopyDetected',
    message: 'Cloud sync "conflict copy" folder detected',
    route,
    extra: {
      source: 'CloudSyncEngine',
      operation: 'reconcile-project',
    },
  })
}

export function reportCloudSyncUntrackedLocalChanges({
  remoteProjectId,
  remoteRevision,
  baseFileCount,
  localFileCount,
}: {
  remoteProjectId: string
  remoteRevision?: Revision
  baseFileCount: number
  localFileCount: number
}) {
  submit({
    code: ClientErrorCode.CloudSyncUntrackedLocalChanges,
    errorName: 'CloudSyncUntrackedLocalChanges',
    message: 'Cloud sync detected local changes without queued work.',
    route,
    dedupeKey: `CloudSync:untracked-local-changes:${remoteProjectId}:${remoteRevision ?? 'none'}`,
    extra: {
      source: 'CloudSyncEngine',
      operation: 'reconcile-project',
      remoteProjectId,
      remoteRevision,
      baseFileCount,
      localFileCount,
      recoveryAction: 'sync-project',
    },
  })
}

export type CloudSyncFailureOperation =
  | 'conflict-resolution'
  | 'mutation'
  | 'remote-index'
  | 'sync'

function getCloudSyncFailureDedupeKey({
  operation,
  errorType,
  cloudApiStatus,
  failureKind,
  context,
}: {
  operation: CloudSyncFailureOperation
  errorType: string
  cloudApiStatus?: number
  failureKind?: string
  context?: CloudSyncFailureTelemetryContext
}) {
  const baseKey = `CloudSync:failure:${operation}:${errorType}:${cloudApiStatus ?? 'none'}:${failureKind ?? 'unknown'}`
  if (!context) {
    return baseKey
  }

  const withoutAgeBucket = (snapshot: OutboxSnapshot | undefined) => {
    if (!snapshot?.readSucceeded) {
      return snapshot
    }
    const { oldestEntryAgeBucket: _oldestEntryAgeBucket, ...stableSnapshot } =
      snapshot
    return stableSnapshot
  }
  return `${baseKey}:${hashString(
    JSON.stringify({
      ...context,
      attemptOutbox: withoutAgeBucket(context.attemptOutbox),
      currentOutbox: withoutAgeBucket(context.currentOutbox),
    })
  )}`
}

export function reportCloudSyncFailure(
  operation: CloudSyncFailureOperation,
  error: unknown
) {
  const context = getCloudSyncFailureContext(error)
  const categoryError =
    error instanceof Error && error.cause !== undefined ? error.cause : error
  const failureKind =
    typeof categoryError === 'object' &&
    categoryError !== null &&
    'kind' in categoryError &&
    categoryError.kind === 'remote-upload-forbidden'
      ? categoryError.kind
      : undefined
  const errorType =
    categoryError instanceof CloudApiError
      ? 'CloudApiError'
      : categoryError instanceof TypeError
        ? 'TypeError'
        : categoryError instanceof Error
          ? 'Error'
          : typeof categoryError
  const cloudApiStatus =
    categoryError instanceof CloudApiError ? categoryError.status : undefined

  submit({
    code: ClientErrorCode.CloudSyncFailure,
    errorName: 'CloudSyncFailure',
    message: `Cloud sync failed during ${operation}.`,
    route,
    dedupeKey: getCloudSyncFailureDedupeKey({
      operation,
      errorType,
      cloudApiStatus,
      failureKind,
      context,
    }),
    extra: {
      source: 'CloudSyncEngine',
      operation,
      errorType,
      cloudApiStatus,
      failureKind,
      ...(context
        ? {
            ...context,
            replacementUploadIncludedDeletedPaths:
              context.replacementUploadDeletedPathCount === undefined
                ? undefined
                : context.replacementUploadDeletedPathCount > 0,
          }
        : {}),
    },
  })
}
