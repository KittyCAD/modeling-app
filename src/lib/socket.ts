import { withAPIBaseURL } from '@src/lib/withBaseURL'

export class SocketConnectionError extends Error {
  code?: number
  reason?: string

  constructor(message: string, options?: { code?: number; reason?: string }) {
    super(message)
    this.name = 'SocketConnectionError'
    this.code = options?.code
    this.reason = options?.reason
  }
}

export function Socket<T extends WebSocket>(
  WsClass: new (url: string) => T,
  urlOrPath: string,
  token: string,
  options?: {
    signal?: AbortSignal
  }
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ws = new WsClass(
      urlOrPath.includes('ws:') || urlOrPath.includes('wss:')
        ? urlOrPath
        : withAPIBaseURL(urlOrPath)
    )
    let pending = true

    function cleanupPendingConnectionListeners() {
      options?.signal?.removeEventListener('abort', handleAbort)
      ws.removeEventListener('error', handleError)
      ws.removeEventListener('open', handleOpen)
    }

    function handleAbort() {
      if (!pending) {
        return
      }
      pending = false
      cleanupPendingConnectionListeners()
      ws.close()
      reject(new SocketConnectionError('WebSocket connection was canceled'))
    }

    function handleError() {
      if (!pending) {
        return
      }
      pending = false
      cleanupPendingConnectionListeners()
      ws.close()
      reject(new SocketConnectionError('WebSocket connection failed'))
    }

    function handleOpen() {
      if (!pending) {
        return
      }
      pending = false
      cleanupPendingConnectionListeners()
      ws.send(
        JSON.stringify({
          type: 'headers',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
      )
      resolve(ws)
    }

    if (options?.signal?.aborted) {
      handleAbort()
      return
    }

    options?.signal?.addEventListener('abort', handleAbort, { once: true })
    ws.addEventListener('error', handleError)
    ws.addEventListener('open', handleOpen, { once: true })

    ws.addEventListener('close', (event: CloseEvent) => {
      console.log(urlOrPath, 'closed')
      if (!pending) {
        return
      }
      pending = false
      cleanupPendingConnectionListeners()
      reject(
        new SocketConnectionError('WebSocket closed before opening', {
          code: event.code,
          reason: event.reason,
        })
      )
    })
  })
}

export function ZooSocket(path: string, token: string): Promise<WebSocket> {
  return Socket(WebSocket, path, token)
}
