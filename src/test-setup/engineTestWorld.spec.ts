import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterEach, expect, it, vi } from 'vitest'

class ClosingWebSocket extends EventTarget {
  static OPEN = 1
  static CLOSED = 3
  static latest: ClosingWebSocket
  readyState = 0
  binaryType: BinaryType = 'blob'

  constructor() {
    super()
    ClosingWebSocket.latest = this
  }

  close() {
    if (this.readyState === ClosingWebSocket.CLOSED) return
    this.readyState = ClosingWebSocket.CLOSED
    this.dispatchEvent(new CloseEvent('close', { code: 1006 }))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('rejects setup when the engine socket closes before authentication', async () => {
  vi.stubGlobal('WebSocket', ClosingWebSocket)
  const opening = buildTheWorldAndConnectToEngine({ webrtc: false })
  const rejected = expect(opening).rejects.toThrow(
    'The test engine connection closed before authentication'
  )
  ClosingWebSocket.latest.close()
  await rejected
}, 2_000)

it('rejects setup when starting the engine connection fails', async () => {
  vi.spyOn(ConnectionManager.prototype, 'start').mockRejectedValue(
    new Error('Engine connection could not start')
  )
  await expect(
    buildTheWorldAndConnectToEngine({ webrtc: false })
  ).rejects.toThrow('Engine connection could not start')
}, 2_000)
