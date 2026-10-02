import { decode } from '@msgpack/msgpack'
import {
  belongsToRequest,
  parseMigrationMessage,
  type MigrationClientMessage,
  type MigrationOperation,
  type MigrationProgress,
  type MigrationRequest,
  type MigrationServerMessage,
} from '@src/lib/kclMigration/protocol'
import { isErr } from '@src/lib/trap'
import { Socket } from '@src/lib/socket'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

export interface MigrationConnection {
  cancel: () => void
  close: () => void
}

/** History and acknowledgements use their own socket, independent of an active run. */
export async function migrationConversationCommand(
  command: Extract<MigrationClientMessage, { type: 'history' | 'application' }>,
  token: string,
  signal: AbortSignal
): Promise<
  Extract<MigrationServerMessage, { type: 'history' | 'application' }>
> {
  const url = new URL(withAPIBaseURL('/ws/ml/kcl-migration'))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
  const ws = await Socket(WebSocket, url.href, token, deadline)
  ws.binaryType = 'arraybuffer'
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (
      result:
        | Extract<MigrationServerMessage, { type: 'history' | 'application' }>
        | Error
    ) => {
      if (settled) return
      settled = true
      deadline.removeEventListener('abort', abort)
      ws.close()
      if (isErr(result)) reject(result)
      else resolve(result)
    }
    const abort = () =>
      finish(new Error('Migration history request was cancelled or timed out.'))
    deadline.addEventListener('abort', abort, { once: true })
    ws.addEventListener('close', () =>
      finish(
        new Error('Migration history connection closed before confirmation.')
      )
    )
    ws.addEventListener('error', () =>
      finish(new Error('Migration history connection failed.'))
    )
    ws.addEventListener('message', (event: MessageEvent<unknown>) => {
      try {
        const raw: unknown =
          typeof event.data === 'string'
            ? JSON.parse(event.data)
            : event.data instanceof ArrayBuffer
              ? decode(new Uint8Array(event.data))
              : null
        const response = parseMigrationMessage(raw)
        if (isErr(response)) return finish(response)
        if (response.type === 'pong') return
        if (response.type === 'error') return finish(new Error(response.detail))
        if (
          command.type === 'history' &&
          response.type === 'history' &&
          response.conversation_id === command.conversation_id &&
          response.entries.every(
            (entry) => entry.conversation_id === command.conversation_id
          )
        )
          return finish(response)
        if (
          command.type === 'application' &&
          response.type === 'application' &&
          response.operation_id === command.operation_id &&
          response.application.status === command.status &&
          response.application.revision === command.expected_revision + 1
        )
          return finish(response)
        finish(
          new Error(
            'The migration history response belongs to a different request.'
          )
        )
      } catch {
        finish(new Error('The migration history response could not be read.'))
      }
    })
    if (deadline.aborted) abort()
    else ws.send(JSON.stringify(command))
  })
}

/** One operation per connection; reconnects query status without resubmitting work. */
export async function connectMigration({
  request,
  token,
  signal,
  statusOnly = false,
  onOperation,
  onProgress,
  onError,
  onDisconnect,
}: {
  request: MigrationRequest
  token: string
  signal: AbortSignal
  statusOnly?: boolean
  onOperation: (operation: MigrationOperation) => void
  onProgress: (message: MigrationProgress) => void
  onError: (error: Error) => void
  onDisconnect: () => void
}): Promise<MigrationConnection> {
  const url = new URL(withAPIBaseURL('/ws/ml/kcl-migration'))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const connecting = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
  const ws = await Socket(WebSocket, url.href, token, connecting)
  ws.binaryType = 'arraybuffer'
  let closed = false
  let terminal = false
  let cancelRequested = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let responseTimer: ReturnType<typeof setTimeout> | undefined
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const send = (message: MigrationClientMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
  }
  const close = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    clearTimeout(responseTimer)
    clearTimeout(deadlineTimer)
    signal.removeEventListener('abort', close)
    ws.close()
  }
  const fail = (error: Error) => {
    close()
    onError(error)
  }
  ws.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (closed || terminal) return
    try {
      const raw: unknown =
        typeof event.data === 'string'
          ? JSON.parse(event.data)
          : event.data instanceof ArrayBuffer
            ? decode(new Uint8Array(event.data))
            : null
      const message = parseMigrationMessage(raw)
      if (isErr(message)) return fail(message)
      if (message.type === 'error') return fail(new Error(message.detail))
      if (message.type === 'progress') {
        if (message.operation_id === request.request_id && !statusOnly) {
          onProgress(message.message)
        }
        return
      }
      if (message.type !== 'operation') return
      if (!belongsToRequest(message.operation, request)) {
        return fail(
          new Error(
            'The migration response belongs to a different project or attempt.'
          )
        )
      }
      terminal = message.operation.status !== 'running'
      clearTimeout(responseTimer)
      if (!terminal && deadlineTimer === undefined) {
        const remaining = Math.min(
          20 * 60_000,
          Date.parse(message.operation.deadline) - Date.now()
        )
        deadlineTimer = setTimeout(() => {
          close()
          onDisconnect()
        }, Math.max(0, remaining) + 5000)
      }
      if (cancelRequested && !terminal) {
        send({ type: 'cancel', operation_id: request.request_id })
        responseTimer = setTimeout(() => {
          close()
          onDisconnect()
        }, 5000)
      }
      onOperation(message.operation)
      if (terminal) close()
    } catch {
      fail(
        new Error(
          'The migration response could not be read. No changes were applied.'
        )
      )
    }
  })
  ws.addEventListener('close', () => {
    if (closed || terminal) return
    close()
    onDisconnect()
  })
  ws.addEventListener('error', () => {
    if (!closed && !terminal) {
      close()
      onDisconnect()
    }
  })
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) close()
  if (!closed) {
    responseTimer = setTimeout(() => {
      close()
      onDisconnect()
    }, 60_000)
    heartbeat = setInterval(
      () =>
        send(
          statusOnly
            ? { type: 'status', operation_id: request.request_id }
            : { type: 'ping' }
        ),
      statusOnly ? 5000 : 30_000
    )
    send(
      statusOnly
        ? { type: 'status', operation_id: request.request_id }
        : { type: 'start', request }
    )
  }
  return {
    close,
    cancel: () => {
      cancelRequested = true
      send({ type: 'cancel', operation_id: request.request_id })
      clearTimeout(responseTimer)
      responseTimer = setTimeout(() => {
        close()
        onDisconnect()
      }, 5000)
    },
  }
}
