import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Connection } from '@src/lib/engineConnection/connection'
import { PEER_CONNECTION_DISCONNECTED_GRACE_PERIOD_MS } from '@src/lib/engineConnection/peerConnection'
import {
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
} from '@src/lib/engineConnection/utils'

const createConnection = () => {
  const send = vi.fn()
  const tearDownManager = vi.fn()
  const connection = new Connection({
    url: 'wss://example.test/modeling',
    token: '',
    handleOnDataChannelMessage: vi.fn(),
    tearDownManager,
    rejectPendingCommand: vi.fn(),
    handleMessage: vi.fn(),
    getCloudProjectId: () => undefined,
  })

  connection.websocket = {
    readyState: WebSocket.OPEN,
    send,
  } as unknown as WebSocket
  tearDownManager.mockImplementation(() => connection.stopPingPong())

  return { connection, send, tearDownManager }
}

describe('Connection heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('tears down once with a specific code when a pong times out', () => {
    const { connection, send, tearDownManager } = createConnection()

    connection.startPingPong()
    vi.advanceTimersByTime(PING_INTERVAL_MS)

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }))

    vi.advanceTimersByTime(PONG_TIMEOUT_MS)

    expect(tearDownManager).toHaveBeenCalledOnce()
    expect(tearDownManager).toHaveBeenCalledWith({ pingPongTimeout: true })

    vi.advanceTimersByTime(PONG_TIMEOUT_MS)
    expect(tearDownManager).toHaveBeenCalledOnce()
  })

  it('sends the next ping after receiving a pong', () => {
    const { connection, send, tearDownManager } = createConnection()

    connection.startPingPong()
    vi.advanceTimersByTime(PING_INTERVAL_MS)
    connection.setPong(Date.now())
    vi.advanceTimersByTime(PING_INTERVAL_MS)

    expect(send).toHaveBeenCalledTimes(2)
    expect(tearDownManager).not.toHaveBeenCalled()

    connection.stopPingPong()
  })
})

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
    expect(websocketUrl.searchParams.get('webrtc')).toBe('false')
  })

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

describe('peer connection cleanup', () => {
  class TestPeerConnection extends EventTarget {
    connectionState: RTCPeerConnectionState = 'new'
    createDataChannel = vi.fn()
    setRemoteDescription = vi.fn().mockResolvedValue(undefined)
    close() {
      // Native close updates state without dispatching connectionstatechange.
      this.connectionState = 'closed'
    }
    transition(state: RTCPeerConnectionState) {
      this.connectionState = state
      this.dispatchEvent(new Event('connectionstatechange'))
    }
  }

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('cancels a disconnected timer on teardown after normal connection setup', async () => {
    vi.useFakeTimers()
    const peer = new TestPeerConnection()
    vi.stubGlobal(
      'RTCPeerConnection',
      vi.fn(function () {
        return peer
      })
    )
    const tearDownManager = vi.fn()
    const connection = new Connection({
      url: 'ws://localhost',
      token: '',
      handleOnDataChannelMessage: vi.fn(),
      tearDownManager,
      rejectPendingCommand: vi.fn(),
      handleMessage: vi.fn(),
      getCloudProjectId: () => undefined,
    })
    const deferred = () => ({
      promise: Promise.resolve(),
      resolve: vi.fn(),
      reject: vi.fn(),
    })
    connection.deferredConnection = deferred()
    connection.deferredPeerConnection = deferred()
    connection.deferredMediaStreamAndWebrtcStatsCollector = deferred()
    connection.createPeerConnection()
    connection.sdpAnswer = { type: 'answer', sdp: '' }
    await connection.initiateConnectionExclusive()
    peer.transition('connected')
    peer.transition('disconnected')
    vi.advanceTimersByTime(1_000)
    // Simulate a websocket close/idle teardown during the grace period.
    connection.disconnectAll()
    expect(peer.connectionState).toBe('closed')
    // Manager can have a new active connection before the old grace period ends.
    vi.advanceTimersByTime(PEER_CONNECTION_DISCONNECTED_GRACE_PERIOD_MS)
    expect(tearDownManager).not.toHaveBeenCalled()
  })
})
