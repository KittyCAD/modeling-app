import { Socket, type SocketConnectionError } from '@src/lib/socket'
import { describe, expect, it, vi } from 'vitest'

class TestWebSocket extends EventTarget {
  static latest: TestWebSocket

  send = vi.fn()
  close = vi.fn()

  constructor(_url: string) {
    super()
    TestWebSocket.latest = this
  }
}

const TestWebSocketConstructor = TestWebSocket as unknown as new (
  url: string
) => WebSocket

describe('Socket', () => {
  it('authenticates and resolves after the websocket opens', async () => {
    const socketPromise = Socket(
      TestWebSocketConstructor,
      'wss://example.test/socket',
      'token'
    )
    const socket = TestWebSocket.latest

    socket.dispatchEvent(new Event('open'))

    await expect(socketPromise).resolves.toBe(socket)
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'headers',
        headers: {
          Authorization: 'Bearer token',
        },
      })
    )
  })

  it('rejects when the websocket fails before opening', async () => {
    const socketPromise = Socket(
      TestWebSocketConstructor,
      'wss://example.test/socket',
      'token'
    )

    TestWebSocket.latest.dispatchEvent(new Event('error'))

    await expect(socketPromise).rejects.toThrow('WebSocket connection failed')
    expect(TestWebSocket.latest.close).toHaveBeenCalledTimes(1)
  })

  it('rejects when the websocket closes before opening', async () => {
    const socketPromise = Socket(
      TestWebSocketConstructor,
      'wss://example.test/socket',
      'token'
    )

    const closeEvent = new Event('close')
    Object.defineProperty(closeEvent, 'code', { value: 1009 })
    TestWebSocket.latest.dispatchEvent(closeEvent)

    await expect(socketPromise).rejects.toThrow(
      'WebSocket closed before opening'
    )
    await expect(socketPromise).rejects.toMatchObject({
      code: 1009,
    } satisfies Partial<SocketConnectionError>)
  })

  it('closes and rejects a pending websocket when canceled', async () => {
    const abortController = new AbortController()
    const socketPromise = Socket(
      TestWebSocketConstructor,
      'wss://example.test/socket',
      'token',
      abortController.signal
    )
    const socket = TestWebSocket.latest

    abortController.abort()
    socket.dispatchEvent(new Event('open'))

    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(socket.send).not.toHaveBeenCalled()
    await expect(socketPromise).rejects.toThrow(
      'WebSocket connection was canceled'
    )
  })
})
