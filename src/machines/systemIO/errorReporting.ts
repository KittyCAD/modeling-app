import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { isDesktop } from '@src/lib/isDesktop'

export type SystemIOErrorRisk = 'read' | 'write' | 'destructive'
export type SystemIOErrorPhase =
  | 'prepare'
  | 'create'
  | 'lookup'
  | 'scan'
  | 'delete'
  | 'callback'
  | 'navigate'

export class ExpectedSystemIOError extends Error {
  override name = 'ExpectedSystemIOError'
}

export class SystemIOPhaseError extends Error {
  override name = 'SystemIOPhaseError'

  constructor(
    readonly phase: SystemIOErrorPhase,
    cause: unknown
  ) {
    super(
      cause instanceof Error
        ? cause.message
        : 'SystemIO operation failed without an Error object.',
      { cause }
    )
  }
}

const SAFE_ERROR_LABEL = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const SYSTEM_IO_ERROR_PHASES = new Set<SystemIOErrorPhase>([
  'prepare',
  'create',
  'lookup',
  'scan',
  'delete',
  'callback',
  'navigate',
])
const MAX_ERROR_CHAIN_LENGTH = 5

function safeErrorLabel(value: unknown) {
  return typeof value === 'string' && SAFE_ERROR_LABEL.test(value)
    ? value
    : undefined
}

function safeSystemIOErrorPhase(value: unknown) {
  return typeof value === 'string' &&
    SYSTEM_IO_ERROR_PHASES.has(value as SystemIOErrorPhase)
    ? (value as SystemIOErrorPhase)
    : undefined
}

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
    if (
      typeof current !== 'object' ||
      current === null ||
      !('cause' in current)
    ) {
      break
    }
    current = current.cause
  }

  return chain
}

function systemIOErrorDetails(error: unknown) {
  const errorChain = systemIOErrorChain(error)
  const errorName =
    safeErrorLabel(error instanceof Error ? error.name : undefined) ??
    'SystemIOError'
  const errorCode = errorChain
    .map((chainError) =>
      typeof chainError === 'object' &&
      chainError !== null &&
      'code' in chainError
        ? safeErrorLabel(chainError.code)
        : safeErrorLabel(chainError)
    )
    .find(Boolean)
  const rootError = [...errorChain]
    .reverse()
    .find((chainError) => chainError instanceof Error)
  const rootErrorName =
    rootError instanceof Error ? safeErrorLabel(rootError.name) : undefined
  const phase = [...errorChain]
    .reverse()
    .map((chainError) =>
      chainError instanceof SystemIOPhaseError
        ? safeSystemIOErrorPhase(chainError.phase)
        : undefined
    )
    .find(Boolean)

  return {
    errorName,
    errorType: error instanceof Error ? 'Error' : typeof error,
    ...(errorCode ? { errorCode } : {}),
    ...(errorChain.length > 1 && rootErrorName ? { rootErrorName } : {}),
    ...(phase ? { phase } : {}),
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
  const extraPhase = safeSystemIOErrorPhase(safeExtra.phase)
  delete safeExtra.phase
  const filesystem = isDesktop() ? 'electron' : 'opfs'
  const {
    errorName,
    phase: errorPhase,
    ...errorDetails
  } = systemIOErrorDetails(args.error)
  const phase = extraPhase ?? errorPhase
  const message = `SystemIO ${args.risk} operation failed during ${args.operation}.`

  void reportClientError({
    code: ClientErrorCode.SystemIOError,
    message,
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
