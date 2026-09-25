import { decode } from '@msgpack/msgpack'
import {
  belongsToRequest,
  parseMigrationMessage,
  type MigrationClientMessage,
  type MigrationOperation,
  type MigrationRequest,
} from '@src/lib/kclMigration/protocol'
import { isErr } from '@src/lib/trap'
import { Socket } from '@src/lib/socket'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

export interface MigrationConnection {
  cancel: () => void
  close: () => void
}

/** One operation per connection; reconnects query status without resubmitting work. */
export async function connectMigration({
  request,
  token,
  signal,
  statusOnly = false,
  onOperation,
  onError,
  onDisconnect,
}: {
  request: MigrationRequest
  token: string
  signal: AbortSignal
  statusOnly?: boolean
  onOperation: (operation: MigrationOperation) => void
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
