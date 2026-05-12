import type { WebSocketRequest } from '@kittycad/lib'
import { Connection } from '@src/network/connection'
import type { EngineTransport } from '@src/network/engineTransport'
import type { ManagerTearDown } from '@src/network/utils'

export type ZooWebSocketTransportOptions = ConstructorParameters<
  typeof Connection
>[0]

export class ZooWebSocketTransport implements EngineTransport {
  readonly kind = 'zoo_websocket'
  readonly connection: Connection

  constructor(options: ZooWebSocketTransportOptions) {
    this.connection = new Connection(options)
  }

  get connected() {
    return this.connection.connected
  }

  connect() {
    return this.connection.connect()
  }

  tearDown(_options?: ManagerTearDown) {
    this.connection.disconnectAll()
  }

  send(message: WebSocketRequest) {
    this.connection.send(message)
  }

  unreliableSend(message: WebSocketRequest) {
    this.connection.unreliableSend(message)
  }
}
