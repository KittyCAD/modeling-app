import type { WebSocketRequest } from '@kittycad/lib'
import type { ManagerTearDown } from '@src/network/utils'

export type EngineTransportKind = 'zoo_websocket' | 'occt_wasm'

export interface EngineTransport {
  readonly kind: EngineTransportKind
  readonly connected: boolean
  connect(): Promise<unknown>
  tearDown(options?: ManagerTearDown): void
  send(message: WebSocketRequest): void
  unreliableSend?(message: WebSocketRequest): void
}
