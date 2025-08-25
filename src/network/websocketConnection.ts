import type { Models } from '@kittycad/lib'
import { logger } from './utils'

export const createOnWebSocketOpen = ({
  send,
  token
}:{
  send: (message: Models['WebSocketRequest_type'])=>void,
  token: string | undefined
}) => {
  const onWebSocketOpen = (event: Event) => {
    // TODO: hmmm I do not like this pattern
    // This is required for when the app is running stand-alone / within desktop app.
    // Otherwise when run in a browser, the token is sent implicitly via
    // the Cookie header.
    if (token) {
      send({
        type:'headers',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      // TODO: Why? Why would this need to send a ping?
      // Why not start the pingPong Interval
      // TODO: Send an initial ping
    }

  }
  return onWebSocketOpen
}

export const createOnWebSocketError = () => {
  const onWebSocketError = (event: Event) => {
    logger('onwebsocketerror', event)

    if (event.target instanceof WebSocket) {
      // WS error
      // TODO: this.state = {}
      // well what the fuck?
    }
  }

  return onWebSocketError
}

export const createOnWebSocketMessage = () => {

  const onWebSocketMessage = (event: MessageEvent<any>) => {
    // In the EngineConnection, we're looking for messages to/from
    // the server that relate to the ICE handshake, or WebRTC
    // negotiation. There may be other messages (including ArrayBuffer
    // messages) that are intended for the GUI itself, so be careful
    // when assuming we're the only consumer or that all messages will
    // be carefully formatted here.

    if (typeof event.data !== 'string') {
      // TODO: What?
      return
    }

    const message: Models['WebSocketResponse_type'] = JSON.parse(
      event.data
    )

  }

}