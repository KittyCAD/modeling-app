import {
  ClientErrorCode,
  errorToMessage,
  reportClientError,
} from '@src/lib/clientErrors'
import { isDesktop } from '@src/lib/isDesktop'

export type SystemIOErrorRisk = 'read' | 'write' | 'destructive'

export type SystemIOErrorMetadata = Record<string, unknown> & {
  phase?: string
  partialMutationPossible?: boolean
  dataLossPossible?: boolean
}

export class ExpectedSystemIOError extends Error {
  override name = 'ExpectedSystemIOError'
}

export class SystemIOOperationError extends Error {
  readonly originalError: unknown
  readonly metadata: SystemIOErrorMetadata

  constructor(error: unknown, metadata: SystemIOErrorMetadata) {
    super(
      errorToMessage(error, 'Unknown SystemIO error'),
      error instanceof Error ? { cause: error } : undefined
    )
    this.name = 'SystemIOOperationError'
    this.originalError = error
    this.metadata = metadata
  }
}

export function withSystemIOErrorMetadata(
  error: unknown,
  metadata: SystemIOErrorMetadata
) {
  if (error instanceof SystemIOOperationError) {
    const mergedMetadata: SystemIOErrorMetadata = {
      ...metadata,
      ...error.metadata,
    }
    if (
      metadata.partialMutationPossible !== undefined ||
      error.metadata.partialMutationPossible !== undefined
    ) {
      mergedMetadata.partialMutationPossible =
        metadata.partialMutationPossible === true ||
        error.metadata.partialMutationPossible === true
    }
    if (
      metadata.dataLossPossible !== undefined ||
      error.metadata.dataLossPossible !== undefined
    ) {
      mergedMetadata.dataLossPossible =
        metadata.dataLossPossible === true ||
        error.metadata.dataLossPossible === true
    }
    return new SystemIOOperationError(error.originalError, mergedMetadata)
  }

  return new SystemIOOperationError(error, metadata)
}

export function reportSystemIOError(args: {
  error: unknown
  operation: string
  risk: SystemIOErrorRisk
  source: string
  eventType?: string
  dedupeKey?: string
  extra?: Record<string, unknown>
}) {
  const operationError =
    args.error instanceof SystemIOOperationError ? args.error : undefined
  const originalError = operationError?.originalError ?? args.error

  if (
    args.error instanceof ExpectedSystemIOError ||
    originalError instanceof ExpectedSystemIOError
  ) {
    return
  }

  const message = errorToMessage(args.error, 'Unknown SystemIO error')
  const phase = operationError?.metadata.phase
  const filesystem = isDesktop() ? 'electron' : 'opfs'

  void reportClientError({
    code: ClientErrorCode.SystemIOError,
    message,
    error: originalError,
    dedupeKey:
      args.dedupeKey ??
      `SystemIO:${args.source}:${args.operation}:${phase ?? 'unknown'}:${message}`,
    extra: {
      ...args.extra,
      ...operationError?.metadata,
      source: args.source,
      operation: args.operation,
      risk: args.risk,
      eventType: args.eventType,
      filesystem,
    },
  })
}
