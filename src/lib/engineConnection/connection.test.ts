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
  geometryOnly,
}: {
  geometryOnly?: boolean
}) {
  const callbackOnUnitTestingConnection = vi.fn()
  const connection = new Connection({
    url: 'unused-by-unit-test-connection',
    token: 'token',
    handleOnDataChannelMessage: vi.fn(),
    tearDownManager: vi.fn(),
    rejectPendingCommand: vi.fn(),
    callbackOnUnitTestingConnection,
    unitTestGeometryOnly: geometryOnly,
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

  it('requests a geometry-only engine session without WebRTC', () => {
    createUnitTestConnection({ geometryOnly: true })

    const websocketUrl = new URL(TestWebSocket.instances[0].url)
    expect(websocketUrl.searchParams.get('geometry_only')).toBe('true')
    expect(websocketUrl.searchParams.get('webrtc')).toBe('false')
    expect(websocketUrl.searchParams.has('post_effect')).toBe(false)
  })

  it.each([false, undefined])(
    'keeps SSAO when geometryOnly=%s',
    (geometryOnly) => {
      createUnitTestConnection({ geometryOnly })

      const websocketUrl = new URL(TestWebSocket.instances[0].url)
      expect(websocketUrl.searchParams.has('geometry_only')).toBe(false)
      expect(websocketUrl.searchParams.get('post_effect')).toBe('ssao')
    }
  )

  it('treats session data as the successful geometry-only handshake', () => {
    const { callbackOnUnitTestingConnection, connection } =
      createUnitTestConnection({ geometryOnly: true })
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
