import { Connection } from '@src/lib/engineConnection/connection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class TestWebSocket extends EventTarget {
  static instances: TestWebSocket[] = []

  binaryType: BinaryType = 'blob'
  readonly send = vi.fn()

  constructor(readonly url: string) {
    super()
    TestWebSocket.instances.push(this)
  }
}

function createUnitTestConnection({
  webrtc,
  pool,
}: {
  webrtc?: boolean
  pool?: 'cpu'
}) {
  const callbackOnUnitTestingConnection = vi.fn()
  const connection = new Connection({
    url: 'unused-by-unit-test-connection',
    token: 'token',
    handleOnDataChannelMessage: vi.fn(),
    tearDownManager: vi.fn(),
    rejectPendingCommand: vi.fn(),
    callbackOnUnitTestingConnection,
    unitTestWebrtc: webrtc,
    unitTestPool: pool,
    handleMessage: vi.fn(),
    getCloudProjectId: () => undefined,
  })
  return { callbackOnUnitTestingConnection, connection }
}

describe('unit testing engine connection', () => {
  beforeEach(() => {
    TestWebSocket.instances = []
    vi.stubGlobal('WebSocket', TestWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('can disable WebRTC without requesting the CPU pool', () => {
    createUnitTestConnection({ webrtc: false })

    const websocketUrl = new URL(TestWebSocket.instances[0].url)
    expect(websocketUrl.searchParams.get('webrtc')).toBe('false')
    expect(websocketUrl.searchParams.has('pool')).toBe(false)
  })

  it('routes compatible tests without WebRTC to the CPU pool', () => {
    createUnitTestConnection({ webrtc: false, pool: 'cpu' })

    const websocketUrl = new URL(TestWebSocket.instances[0].url)
    expect(websocketUrl.searchParams.get('webrtc')).toBe('false')
    expect(websocketUrl.searchParams.get('pool')).toBe('cpu')
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
})
