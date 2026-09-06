import {
  createOnConnectionStateChange,
  PEER_CONNECTION_DISCONNECTED_GRACE_PERIOD_MS,
} from '@src/lib/engineConnection/peerConnection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class TestPeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = 'new'
}

const setup = () => {
  const peerConnection = new TestPeerConnection()
  const dispatchEvent = vi.fn(() => true)
  const tearDownManager = vi.fn()
  const { onConnectionStateChange, clearDisconnectedTimeout } =
    createOnConnectionStateChange({
      dispatchEvent,
      connection: { mediaStream: new MediaStream() },
      tearDownManager,
    })
  peerConnection.addEventListener(
    'connectionstatechange',
    onConnectionStateChange
  )

  return {
    peerConnection,
    dispatchEvent,
    tearDownManager,
    clearDisconnectedTimeout,
  }
}

describe('createOnConnectionStateChange', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('allows the same peer connection to recover', () => {
    const { peerConnection, tearDownManager } = setup()

    peerConnection.connectionState = 'disconnected'
    peerConnection.dispatchEvent(new Event('connectionstatechange'))
    peerConnection.connectionState = 'connecting'
    peerConnection.dispatchEvent(new Event('connectionstatechange'))
    vi.advanceTimersByTime(PEER_CONNECTION_DISCONNECTED_GRACE_PERIOD_MS)
    peerConnection.connectionState = 'connected'
    peerConnection.dispatchEvent(new Event('connectionstatechange'))

    expect(tearDownManager).not.toHaveBeenCalled()
  })

  it('tears down a connection that remains disconnected', () => {
    const { peerConnection, dispatchEvent, tearDownManager } = setup()

    peerConnection.connectionState = 'disconnected'
    peerConnection.dispatchEvent(new Event('connectionstatechange'))
    vi.advanceTimersByTime(PEER_CONNECTION_DISCONNECTED_GRACE_PERIOD_MS)

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'offline' })
    )
    expect(tearDownManager).toHaveBeenCalledWith({
      peerConnectionDisconnected: true,
    })
  })

  it('cancels a pending teardown when the connection is cleaned up', () => {
    const { peerConnection, tearDownManager, clearDisconnectedTimeout } =
      setup()

    peerConnection.connectionState = 'disconnected'
    peerConnection.dispatchEvent(new Event('connectionstatechange'))
    clearDisconnectedTimeout()
    vi.advanceTimersByTime(PEER_CONNECTION_DISCONNECTED_GRACE_PERIOD_MS)

    expect(tearDownManager).not.toHaveBeenCalled()
  })

  it('cancels the deadline after a direct disconnected-to-connected recovery', () => {
    const { peerConnection, tearDownManager } = setup()
    peerConnection.connectionState = 'disconnected'
    peerConnection.dispatchEvent(new Event('connectionstatechange'))
    vi.advanceTimersByTime(9_000)
    peerConnection.connectionState = 'connected'
    peerConnection.dispatchEvent(new Event('connectionstatechange'))
    vi.advanceTimersByTime(30_000)

    expect(tearDownManager).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  const terminalStates: Array<'failed' | 'closed'> = ['failed', 'closed']
  it.each(terminalStates)(
    'tears down immediately on %s and cancels the earlier deadline',
    (terminalState) => {
      const { peerConnection, tearDownManager } = setup()
      peerConnection.connectionState = 'disconnected'
      peerConnection.dispatchEvent(new Event('connectionstatechange'))
      vi.advanceTimersByTime(1_000)
      peerConnection.connectionState = terminalState
      peerConnection.dispatchEvent(new Event('connectionstatechange'))

      expect(tearDownManager).toHaveBeenCalledTimes(1)
      expect(tearDownManager).toHaveBeenCalledWith(
        terminalState === 'failed'
          ? { peerConnectionFailed: true }
          : { peerConnectionClosed: true }
      )
      vi.advanceTimersByTime(30_000)
      expect(tearDownManager).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('gives a later interruption its own deadline without retaining the old one', () => {
    const { peerConnection, tearDownManager } = setup()
    const changeState = (state: RTCPeerConnectionState) => {
      peerConnection.connectionState = state
      peerConnection.dispatchEvent(new Event('connectionstatechange'))
    }
    changeState('disconnected')
    vi.advanceTimersByTime(5_000)
    changeState('connected')
    changeState('disconnected')
    vi.advanceTimersByTime(9_999)
    expect(tearDownManager).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(tearDownManager).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
