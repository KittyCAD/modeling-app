import { promiseFactory } from '@src/lib/utils'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

export class SocketConnectionError extends Error {
  readonly code?: number

  constructor(message: string, code?: number) {
    super(message)
    this.code = code
  }
}

export function Socket<T extends WebSocket>(
  WsClass: new (url: string) => T,
  urlOrPath: string,
  token: string,
  signal?: AbortSignal
): Promise<T> {
  const { promise, resolve, reject } = promiseFactory<T>()
  const rejectError = reject as (reason?: unknown) => void

  let ws: T

  if (urlOrPath.includes('ws:') || urlOrPath.includes('wss:')) {
    ws = new WsClass(urlOrPath)
  } else {
    ws = new WsClass(withAPIBaseURL(urlOrPath))
  }

  let pending = true
  function finishPending() {
    if (!pending) {
      return false
    }
    pending = false
    signal?.removeEventListener('abort', handleAbort)
    return true
  }
  function handleAbort() {
    if (!finishPending()) {
      return
    }
    ws.close()
    rejectError(new SocketConnectionError('WebSocket connection was canceled'))
  }

  ws.addEventListener('open', () => {
    if (!finishPending()) {
      return
    }
    ws.send(
      JSON.stringify({
        type: 'headers',
        headers: {
          Authorization: 'Bearer ' + token,
        },
      })
    )
    resolve(ws)
  })

  ws.addEventListener('error', () => {
    if (!finishPending()) {
      return
    }
    ws.close()
    rejectError(new SocketConnectionError('WebSocket connection failed'))
  })

  ws.addEventListener('close', (event) => {
    console.log(urlOrPath, 'closed')
    if (!finishPending()) {
      return
    }
    rejectError(
      new SocketConnectionError('WebSocket closed before opening', event.code)
    )
  })

  signal?.addEventListener('abort', handleAbort, { once: true })
  if (signal?.aborted) {
    handleAbort()
  }

  return promise
}

export function ZooSocket(path: string, token: string): Promise<WebSocket> {
  return Socket(WebSocket, path, token)
}
