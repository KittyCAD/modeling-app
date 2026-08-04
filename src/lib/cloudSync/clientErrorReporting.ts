import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { CloudApiError } from '@src/lib/cloudSync/cloudApi'
import { reportRejection } from '@src/lib/trap'

const route = '/cloud-sync'

function submit(params: Parameters<typeof reportClientError>[0]) {
  void Promise.resolve(reportClientError(params)).catch(reportRejection)
}

export function reportCloudSyncConflict() {
  submit({
    code: ClientErrorCode.CloudSyncConflict,
    errorName: 'CloudSyncConflict',
    message: 'Cloud sync conflict: local and remote both changed.',
    route,
    extra: {
      source: 'CloudSyncEngine',
      operation: 'reconcile-project',
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
