import { promiseFactory } from '@src/lib/utils'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

export function Socket<T extends WebSocket>(
  WsClass: new (url: string) => T,
  path: string,
  token: string
): Promise<T> {
  const ws = new WsClass(withAPIBaseURL(path))
  const { promise, resolve } = promiseFactory<T>()

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
    console.log('CLOSED')
  })

  return promise
}

export function ZooSocket(path: string, token: string): Promise<WebSocket> {
  return Socket(WebSocket, path, token)
}
