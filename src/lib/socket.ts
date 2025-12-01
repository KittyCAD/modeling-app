import { promiseFactory } from '@src/lib/utils'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

export function Socket<T extends WebSocket>(
  WsClass: new (url: string) => T,
  urlOrPath: string,
  token: string
): Promise<T> {
  const { promise, resolve } = promiseFactory<T>()

  let ws

  if (urlOrPath.includes('ws:') || urlOrPath.includes('wss:')) {
    ws = new WsClass(urlOrPath)
  } else {
    ws = new WsClass(withAPIBaseURL(urlOrPath))
  }

  ws.addEventListener('open', () => {
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

  ws.addEventListener('close', () => {
    console.log(urlOrPath, 'closed')
  })

  return promise
}

export function ZooSocket(path: string, token: string): Promise<WebSocket> {
  return Socket(WebSocket, path, token)
}
