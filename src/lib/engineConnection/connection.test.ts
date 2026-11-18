import { PING_INTERVAL_MS } from '@src/lib/engineConnection/utils'
import { Connection } from '@src/lib/engineConnection/connection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class TestWebSocket extends EventTarget {
  static instances: TestWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = TestWebSocket.OPEN
  close() {
    this.readyState = TestWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  binaryType: BinaryType = 'blob'
  readonly send = vi.fn()

  constructor(readonly url: string) {
    super()
    TestWebSocket.instances.push(this)
  }
}

function createUnitTestConnection({
  webrtc,
  geometryOnly,
}: {
  webrtc?: boolean
  geometryOnly?: boolean
}) {
  const callbackOnUnitTestingConnection = vi.fn()
  const connection = new Connection({
    url: 'unused-by-unit-test-connection',
    token: 'token',
    handleOnDataChannelMessage: vi.fn(),
    recordShutdownTrigger: vi.fn(() => true),
    tearDownManager: vi.fn(),
    rejectPendingCommand: vi.fn(),
    callbackOnUnitTestingConnection,
    unitTestWebrtc: webrtc,
    unitTestGeometryOnly: geometryOnly,
    handleMessage: vi.fn(),
    getCloudProjectId: () => undefined,
  })
  return { callbackOnUnitTestingConnection, connection }
}

describe('unit testing engine connection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    TestWebSocket.instances = []
    vi.stubGlobal('WebSocket', TestWebSocket)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('can disable WebRTC without requesting geometry-only mode', () => {
    createUnitTestConnection({ webrtc: false })

    const websocketUrl = new URL(TestWebSocket.instances[0].url)
    expect(websocketUrl.searchParams.get('webrtc')).toBe('false')
    expect(websocketUrl.searchParams.get('geometry_only')).toBe('false')
    expect(websocketUrl.searchParams.has('pool')).toBe(false)
    expect(websocketUrl.searchParams.get('post_effect')).toBe('ssao')
  })

  it('requests geometry-only mode without selecting an explicit pool', () => {
    createUnitTestConnection({ webrtc: false, geometryOnly: true })

    const websocketUrl = new URL(TestWebSocket.instances[0].url)
    expect(websocketUrl.searchParams.get('webrtc')).toBe('false')
    expect(websocketUrl.searchParams.get('geometry_only')).toBe('true')
    expect(websocketUrl.searchParams.has('pool')).toBe(false)
    expect(websocketUrl.searchParams.has('post_effect')).toBe(false)
  })

  it('forwards engine errors to the command response handler', () => {
    const { connection } = createUnitTestConnection({
      webrtc: false,
      geometryOnly: true,
    })
    const websocket = TestWebSocket.instances[0]
    const errorResponse = {
      success: false,
      request_id: 'test-request-id',
      errors: [
        {
          error_code: 'internal_engine',
          message: 'Internal engine error on request',
        },
      ],
    }

    websocket.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(errorResponse) })
    )

    expect(connection.handleMessage).toHaveBeenCalledOnce()
    expect(connection.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: JSON.stringify(errorResponse) })
    )
  })

  it('treats session data as the successful no-WebRTC handshake', () => {
    const { callbackOnUnitTestingConnection, connection } =
      createUnitTestConnection({ webrtc: false })
    const websocket = TestWebSocket.instances[0]

    websocket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          success: true,
          request_id: null,
          resp: {
            type: 'modeling_session_data',
            data: { session: { api_call_id: 'test-api-call-id' } },
          },
        }),
      })
    )

    expect(callbackOnUnitTestingConnection).toHaveBeenCalledWith('auth success')
    expect(connection.handleMessage).toHaveBeenCalledOnce()
  })
  it.each([false, true])(
    'keeps an authenticated test session alive while modeling is idle (WebRTC: %s)',
    (webrtc) => {
      const { connection } = createUnitTestConnection({ webrtc })
      const websocket = TestWebSocket.instances[0]
      const message = (resp: object) =>
        websocket.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ success: true, request_id: null, resp }),
          })
        )
      vi.advanceTimersByTime(PING_INTERVAL_MS)
      expect(websocket.send).not.toHaveBeenCalled()
      message(
        webrtc
          ? { type: 'ice_server_info', data: {} }
          : {
              type: 'modeling_session_data',
              data: { session: { api_call_id: 'session' } },
            }
      )
      vi.advanceTimersByTime(PING_INTERVAL_MS)
      expect(websocket.send).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ type: 'ping' })
      )
      vi.advanceTimersByTime(PING_INTERVAL_MS)
      expect(websocket.send).toHaveBeenCalledTimes(1)
      message({ type: 'pong' })
      vi.advanceTimersByTime(PING_INTERVAL_MS)
      expect(websocket.send).toHaveBeenCalledTimes(2)
      websocket.close()
      vi.advanceTimersByTime(3 * PING_INTERVAL_MS)
      expect(websocket.send).toHaveBeenCalledTimes(2)
      expect(connection.pingIntervalId).toBeUndefined()
    }
  )
})
