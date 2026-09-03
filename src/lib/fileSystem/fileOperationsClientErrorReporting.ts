import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import type { FileSystemError } from '@src/lib/fileSystem/fileSystem'

export type FileOperationsOperation =
  | 'copy'
  | 'create-directory'
  | 'create-file'
  | 'create-unique-directory'
  | 'create-unique-file'
  | 'exists'
  | 'move'
  | 'read-directory'
  | 'read-file'
  | 'remove'
  | 'rename'
  | 'stat'
  | 'write-file'

const SAFE_CAUSE_CODES = new Set([
  'EACCES',
  'EEXIST',
  'EIO',
  'ENOENT',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EPERM',
])

const SAFE_CAUSE_NAMES = new Set([
  'NotAllowedError',
  'NotFoundError',
  'NotSupportedError',
  'PathExistsError',
  'SecurityError',
])

function safeProperty(cause: unknown, property: 'code' | 'name') {
  const allowlist = property === 'code' ? SAFE_CAUSE_CODES : SAFE_CAUSE_NAMES
  if (property === 'code' && typeof cause === 'string') {
    return allowlist.has(cause) ? cause : undefined
  }
  if (typeof cause !== 'object' || cause === null || !(property in cause)) {
    return undefined
  }

  const value = (cause as Record<string, unknown>)[property]
  if (typeof value !== 'string') {
    return undefined
  }

  return allowlist.has(value) ? value : undefined
}

function fileSystemErrorReportDetails(error: FileSystemError) {
  return {
    errorType: error._tag,
    causeType: error.cause instanceof Error ? 'Error' : typeof error.cause,
    causeCode: safeProperty(error.cause, 'code'),
    causeName: safeProperty(error.cause, 'name'),
  }
}

function isExpectedCollision(
  operation: FileOperationsOperation,
  error: FileSystemError
) {
  return (
    error._tag === 'FileAlreadyExists' &&
    (operation === 'create-directory' || operation === 'create-file')
  )
}

/**
 * Report a failed coordinated operation without exposing filesystem paths.
 * Strict-creation collisions are expected product control flow, not incidents.
 */
export function reportFileOperationsError(
  operation: FileOperationsOperation,
  error: FileSystemError
) {
  if (isExpectedCollision(operation, error)) {
    return
  }

  const details = fileSystemErrorReportDetails(error)

  void reportClientError({
    code: ClientErrorCode.FileOperationsError,
    message: `FileOperations operation failed during ${operation}.`,
    errorName: error._tag,
    dedupeKey: `FileOperations:${operation}:${error._tag}:${details.causeCode ?? details.causeName ?? details.causeType}`,
    // File routes may contain encoded absolute paths. Do not let the shared
    // reporter infer the current route for filesystem failures.
    route: 'file-operations',
    extra: {
      ...details,
      operation,
      fileSystemOperation: error.operation,
      hasDestination: error.destination !== undefined,
    },
  })
}
