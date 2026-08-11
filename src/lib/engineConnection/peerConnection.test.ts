import type { Connection } from '@src/lib/engineConnection/connection'
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
      connection: { mediaStream: new MediaStream() } as Connection,
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
})
