import { EngineDebugger } from '@src/lib/debugger'
import { Connection } from '@src/lib/engineConnection/connection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
