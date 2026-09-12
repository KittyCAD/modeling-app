import { EngineDebugger } from '@src/lib/debugger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Connection } from '@src/lib/engineConnection/connection'
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

const openStates: RTCPeerConnectionState[] = [
  'new',
  'connecting',
  'connected',
  'disconnected',
  'failed',
]

function setup(initialState: RTCPeerConnectionState) {
  const connection = new Connection({
    url: 'ws://localhost',
    token: '',
    handleOnDataChannelMessage: vi.fn(),
    tearDownManager: vi.fn(),
    rejectPendingCommand: vi.fn(),
    handleMessage: vi.fn(),
    getCloudProjectId: () => undefined,
  })
  const peer = new RTCPeerConnection()
  let state = initialState
  Object.defineProperty(peer, 'connectionState', { get: () => state })
  const close = vi.spyOn(peer, 'close').mockImplementation(() => {
    state = 'closed'
  })
  connection.peerConnection = peer
  return { connection, peer, close }
}

describe('Connection.disconnectPeerConnection', () => {
  beforeEach(() => {
    vi.spyOn(EngineDebugger, 'addLog').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it.each(openStates)('closes a peer in the %s state', (state) => {
    const { connection, peer, close } = setup(state)

    connection.disconnectPeerConnection()

    expect(close).toHaveBeenCalledTimes(1)
    expect(peer.connectionState).toBe('closed')
  })

  it('does not close an already closed peer', () => {
    const { connection, close } = setup('closed')

    connection.disconnectPeerConnection()

    expect(close).not.toHaveBeenCalled()
  })

  it('does not close the same peer twice on repeated cleanup', () => {
    const { connection, close } = setup('connected')

    connection.disconnectPeerConnection()
    connection.disconnectPeerConnection()

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the peer is missing', () => {
    const { connection, close } = setup('connected')
    connection.peerConnection = undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => connection.disconnectPeerConnection()).not.toThrow()
    expect(close).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'peerConnection is undefined during disconnectPeerConnection'
    )
  })
})
