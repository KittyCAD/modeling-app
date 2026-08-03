import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { isDesktop } from '@src/lib/isDesktop'

export type SystemIOErrorRisk = 'read' | 'write' | 'destructive'

export class ExpectedSystemIOError extends Error {
  override name = 'ExpectedSystemIOError'
}

const SAFE_ERROR_LABEL = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/

function safeErrorLabel(value: unknown) {
  return typeof value === 'string' && SAFE_ERROR_LABEL.test(value)
    ? value
    : undefined
}

function systemIOErrorDetails(error: unknown) {
  const errorName =
    safeErrorLabel(error instanceof Error ? error.name : undefined) ??
    'SystemIOError'
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? safeErrorLabel(error.code)
      : safeErrorLabel(error)

  return {
    errorName,
    errorType: error instanceof Error ? 'Error' : typeof error,
    ...(errorCode ? { errorCode } : {}),
  }
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
  if (args.error instanceof ExpectedSystemIOError) {
    return
  }

  const phase =
    typeof args.extra?.phase === 'string' ? args.extra.phase : undefined
  const filesystem = isDesktop() ? 'electron' : 'opfs'
  const { errorName, ...errorDetails } = systemIOErrorDetails(args.error)
  const message = `SystemIO ${args.risk} operation failed during ${args.operation}.`

  void reportClientError({
    code: ClientErrorCode.SystemIOError,
    message,
    errorName,
    dedupeKey:
      args.dedupeKey ??
      `SystemIO:${args.source}:${args.operation}:${phase ?? 'unknown'}:${errorName}:${errorDetails.errorCode ?? 'unknown'}`,
    extra: {
      ...args.extra,
      ...errorDetails,
      source: args.source,
      operation: args.operation,
      risk: args.risk,
      eventType: args.eventType,
      filesystem,
    },
  })
}
