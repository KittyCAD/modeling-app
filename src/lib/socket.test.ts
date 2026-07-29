import { Socket, type SocketConnectionError } from '@src/lib/socket'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class TestWebSocket extends EventTarget {
  static latest: TestWebSocket

  readonly url: string
  readonly sentPayloads: string[] = []
  close = vi.fn()

  constructor(url: string) {
    super()
    this.url = url
    TestWebSocket.latest = this
  }

  send(payload: string) {
    this.sentPayloads.push(payload)
  }
}

const TestWebSocketConstructor = TestWebSocket as unknown as new (
  url: string
) => WebSocket

describe('Socket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authenticates and resolves after the websocket opens', async () => {
    const socketPromise = Socket(
      TestWebSocketConstructor,
      'wss://example.test/socket',
      'token'
    )
    const socket = TestWebSocket.latest

    socket.dispatchEvent(new Event('open'))

    await expect(socketPromise).resolves.toBe(socket)
    expect(socket.sentPayloads).toStrictEqual([
      JSON.stringify({
        type: 'headers',
        headers: {
          Authorization: 'Bearer token',
        },
      }),
    ])
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
    Object.defineProperties(closeEvent, {
      code: { value: 1009 },
      reason: { value: 'message too big' },
    })
    TestWebSocket.latest.dispatchEvent(closeEvent)

    await expect(socketPromise).rejects.toThrow(
      'WebSocket closed before opening'
    )
    await expect(socketPromise).rejects.toMatchObject({
      code: 1009,
      reason: 'message too big',
    } satisfies Partial<SocketConnectionError>)
  })

  it('closes and rejects a pending websocket when canceled', async () => {
    const abortController = new AbortController()
    const socketPromise = Socket(
      TestWebSocketConstructor,
      'wss://example.test/socket',
      'token',
      {
        signal: abortController.signal,
      }
    )
    const socket = TestWebSocket.latest

    abortController.abort()
    socket.dispatchEvent(new Event('open'))

    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(socket.sentPayloads).toStrictEqual([])
    await expect(socketPromise).rejects.toThrow(
      'WebSocket connection was canceled'
    )
  })
})
