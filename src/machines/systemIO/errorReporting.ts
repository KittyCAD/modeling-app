import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { isDesktop } from '@src/lib/isDesktop'

export type SystemIOErrorRisk = 'read' | 'write' | 'destructive'

export class ExpectedSystemIOError extends Error {
  override name = 'ExpectedSystemIOError'
}

const SAFE_ERROR_LABEL = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const SAFE_STACK_FILE = /^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/
const SAFE_STACK_FUNCTION = /^[A-Za-z0-9_$.[\]<>-]+$/
const MAX_STACK_FRAMES = 5

function safeErrorLabel(value: unknown) {
  return typeof value === 'string' && SAFE_ERROR_LABEL.test(value)
    ? value
    : undefined
}

function sanitizedContextError(error: Error, context: string) {
  const sanitizedError = new Error(context)
  const frames = (error.stack ?? '')
    .split('\n')
    .slice(1)
    .flatMap((frame) => {
      const location = frame.match(
        /([A-Za-z0-9_.-]+\.[A-Za-z0-9]+):(\d+):(\d+)\)?$/
      )
      if (!location || !SAFE_STACK_FILE.test(location[1])) {
        return []
      }

      const functionName = frame.match(/^\s*at\s+([^\s(]+)(?:\s|\()/)?.[1]
      const safeFunctionName =
        functionName && SAFE_STACK_FUNCTION.test(functionName)
          ? functionName
          : undefined
      return [
        `    at ${safeFunctionName ? `${safeFunctionName} ` : ''}${location[1]}:${location[2]}:${location[3]}`,
      ]
    })
    .slice(0, MAX_STACK_FRAMES)

  sanitizedError.stack = [`Error: ${context}`, ...frames].join('\n')
  return sanitizedError
}

function systemIOErrorDetails(error: unknown) {
  const errorName =
    safeErrorLabel(error instanceof Error ? error.name : undefined) ??
    'SystemIOError'
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? safeErrorLabel(error.code)
      : safeErrorLabel(error)
  const context = safeErrorLabel(
    error instanceof Error ? error.message : undefined
  )

  return {
    errorName,
    errorType: error instanceof Error ? 'Error' : typeof error,
    ...(errorCode ? { errorCode } : {}),
    ...(context ? { context } : {}),
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

  const safeExtra = { ...args.extra }
  const extraPhase = safeErrorLabel(safeExtra.phase)
  delete safeExtra.phase
  const filesystem = isDesktop() ? 'electron' : 'opfs'
  const {
    errorName,
    context: errorContext,
    ...errorDetails
  } = systemIOErrorDetails(args.error)
  const phase = extraPhase ?? errorContext
  const contextError =
    errorContext && args.error instanceof Error
      ? sanitizedContextError(args.error, errorContext)
      : undefined
  const message = `SystemIO ${args.risk} operation failed during ${args.operation}.`

  void reportClientError({
    code: ClientErrorCode.SystemIOError,
    message,
    ...(contextError ? { error: contextError } : {}),
    errorName,
    dedupeKey:
      args.dedupeKey ??
      `SystemIO:${args.source}:${args.operation}:${phase ?? 'unknown'}:${errorName}:${errorDetails.errorCode ?? 'unknown'}`,
    extra: {
      ...safeExtra,
      ...errorDetails,
      ...(phase ? { phase } : {}),
      source: args.source,
      operation: args.operation,
      risk: args.risk,
      eventType: args.eventType,
      filesystem,
    },
  })
}
