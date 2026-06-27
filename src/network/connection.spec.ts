import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Connection } from '@src/network/connection'

function makeConnection() {
  return new Connection({
    url: 'wss://example.test',
    token: 'test-token',
    handleOnDataChannelMessage: vi.fn(),
    tearDownManager: vi.fn(),
    rejectPendingCommand: vi.fn(),
    handleMessage: vi.fn(),
  })
}

describe('Connection cleanup', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('closes active peer connections and stops media tracks on disconnect', () => {
    const connection = makeConnection()
    const close = vi.fn()
    const stopVideo = vi.fn()
    const stopAudio = vi.fn()

    connection.peerConnection = {
      connectionState: 'connected',
      close,
    } as unknown as RTCPeerConnection
    connection.mediaStream = {
      getTracks: () => [{ stop: stopVideo }, { stop: stopAudio }],
    } as unknown as MediaStream

    connection.disconnectAll()

    expect(close).toHaveBeenCalledOnce()
    expect(stopVideo).toHaveBeenCalledOnce()
    expect(stopAudio).toHaveBeenCalledOnce()
    expect(connection.peerConnection).toBeUndefined()
    expect(connection.mediaStream).toBeUndefined()
  })

  it('does not close peer connections that are already closed', () => {
    const connection = makeConnection()
    const close = vi.fn()

    connection.peerConnection = {
      connectionState: 'closed',
      close,
    } as unknown as RTCPeerConnection

    connection.disconnectPeerConnection()

    expect(close).not.toHaveBeenCalled()
    expect(connection.peerConnection).toBeUndefined()
  })
})
