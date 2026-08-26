import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { CloudApiError } from '@src/lib/cloudSync/cloudApi'
import type { ProjectManifest, Revision } from '@src/lib/cloudSync/types'
import { hashString } from '@src/lib/stringUtils'
import { reportRejection } from '@src/lib/trap'

const route = '/cloud-sync'
let clientInstanceId: string | undefined

/**
 * Privacy boundary for conflict telemetry. Raw local project paths and file
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

export function reportCloudSyncFailure(
  operation: CloudSyncFailureOperation,
  error: unknown
) {
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
    dedupeKey: `CloudSync:failure:${operation}:${errorType}:${cloudApiStatus ?? 'none'}:${failureKind ?? 'unknown'}`,
    extra: {
      source: 'CloudSyncEngine',
      operation,
      errorType,
      cloudApiStatus,
      failureKind,
    },
  })
}
