import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { isDesktop } from '@src/lib/isDesktop'

export type SystemIOErrorRisk = 'read' | 'write' | 'destructive'

export class ExpectedSystemIOError extends Error {
  override name = 'ExpectedSystemIOError'
}

const SAFE_ERROR_LABEL = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const SAFE_STACK_FILE = /^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/
const SAFE_STACK_FUNCTION = /^[A-Za-z0-9_$.[\]<>-]+$/
const SYSTEM_IO_ERROR_CONTEXTS = new Set([
  'wasmInstancePromise',
  'sharedBulkCreateWorkflow',
  'sharedBulkDeleteWorkflow',
  'onFileSystemSuccess',
  'prepareNavigation',
  'onSuccess',
])
const MAX_ERROR_CHAIN_LENGTH = 5
const MAX_STACK_FRAMES = 5

function safeErrorLabel(value: unknown) {
  return typeof value === 'string' && SAFE_ERROR_LABEL.test(value)
    ? value
    : undefined
}

function safeSystemIOErrorContext(value: unknown) {
  return typeof value === 'string' && SYSTEM_IO_ERROR_CONTEXTS.has(value)
    ? value
    : undefined
}

// Context errors retain the real failure in Error.cause. Walk a bounded chain
// so reports can keep safe codes and names without sending cause messages or
// stacks, which may contain customer filesystem paths.
function systemIOErrorChain(error: unknown) {
  const chain: unknown[] = []
  const seen = new Set<object>()
  let current = error

  while (chain.length < MAX_ERROR_CHAIN_LENGTH) {
    if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) {
        break
      }
      seen.add(current)
    }

    chain.push(current)
    if (!(current instanceof Error) || current.cause === undefined) {
      break
    }
    current = current.cause
  }

  return chain
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
  const errorChain = systemIOErrorChain(error)
  const errorName =
    safeErrorLabel(error instanceof Error ? error.name : undefined) ??
    'SystemIOError'
  const errorCode = errorChain
    .map((chainError, index) =>
      typeof chainError === 'object' &&
      chainError !== null &&
      'code' in chainError
        ? safeErrorLabel(chainError.code)
        : index === 0
          ? safeErrorLabel(chainError)
          : undefined
    )
    .find(Boolean)
  const rootError = [...errorChain]
    .reverse()
    .find((chainError) => chainError instanceof Error)
  const rootErrorName =
    rootError instanceof Error ? safeErrorLabel(rootError.name) : undefined
  const context = safeSystemIOErrorContext(
    error instanceof Error ? error.message : undefined
  )

  return {
    errorName,
    errorType: error instanceof Error ? 'Error' : typeof error,
    ...(errorCode ? { errorCode } : {}),
    ...(errorChain.length > 1 && rootErrorName ? { rootErrorName } : {}),
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
  if (
    systemIOErrorChain(args.error).some(
      (error) => error instanceof ExpectedSystemIOError
    )
  ) {
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
