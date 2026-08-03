import {
  ClientErrorCode,
  errorToMessage,
  reportClientError,
} from '@src/lib/clientErrors'
import { isDesktop } from '@src/lib/isDesktop'

export type SystemIOErrorRisk = 'read' | 'write' | 'destructive'

export class ExpectedSystemIOError extends Error {
  override name = 'ExpectedSystemIOError'
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

  const message = errorToMessage(args.error, 'Unknown SystemIO error')
  const phase =
    typeof args.extra?.phase === 'string' ? args.extra.phase : undefined
  const filesystem = isDesktop() ? 'electron' : 'opfs'

  void reportClientError({
    code: ClientErrorCode.SystemIOError,
    message,
    error: args.error,
    dedupeKey:
      args.dedupeKey ??
      `SystemIO:${args.source}:${args.operation}:${phase ?? 'unknown'}:${message}`,
    extra: {
      ...args.extra,
      source: args.source,
      operation: args.operation,
      risk: args.risk,
      eventType: args.eventType,
      filesystem,
    },
  })
}
