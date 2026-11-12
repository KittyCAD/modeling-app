const reportClientError = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return { ...actual, reportClientError }
})

import type * as ClientErrorsModule from '@src/lib/clientErrors'
import type { Connection } from '@src/lib/engineConnection/connection'
import {
  createOnConnectionStateChange,
  createOnDataChannelClose,
} from '@src/lib/engineConnection/peerConnection'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createTestConnection = () => {
  const stats = new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    [
      'pair',
      {
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
        bytesReceived: 100,
      },
    ],
    [
      'local',
      {
        type: 'local-candidate',
        candidateType: 'relay',
        protocol: 'udp',
        relayProtocol: 'udp',
        address: '203.0.113.10',
        port: 3478,
        usernameFragment: 'private-local-fragment',
      },
    ],
    [
      'remote',
      {
        type: 'remote-candidate',
        candidateType: 'host',
        protocol: 'udp',
        address: '203.0.113.20',
        port: 5000,
        usernameFragment: 'private-remote-fragment',
      },
    ],
    [
      'inbound',
      {
        type: 'inbound-rtp',
        kind: 'video',
        packetsReceived: 10,
        packetsLost: 1,
        framesDecoded: 20,
      },
    ],
  ]) as unknown as RTCStatsReport
  const peerConnection = {
    connectionState: 'failed',
    iceConnectionState: 'connected',
    iceGatheringState: 'complete',
    signalingState: 'stable',
    sctp: {
      state: 'connected',
      transport: {
        state: 'failed',
        iceTransport: { state: 'connected' },
      },
    },
    getStats: vi.fn(() => Promise.resolve(stats)),
  } as unknown as RTCPeerConnection
  const recordShutdownTrigger = vi
    .fn()
    .mockReturnValueOnce(true)
    .mockReturnValue(false)
  const connection = {
    id: 'connection-1',
    apiCallId: 'api-call-1',
    peerConnection,
    recordShutdownTrigger,
  } as unknown as Connection

  return { connection, peerConnection, recordShutdownTrigger }
}

describe('WebRTC disconnect diagnostics', () => {
  afterEach(() => {
    reportClientError.mockClear()
  })

  it('reports privacy-safe WebRTC diagnostics only for the first shutdown trigger', async () => {
    const { connection, peerConnection, recordShutdownTrigger } =
      createTestConnection()
    const tearDownManager = vi.fn()
    const onConnectionStateChange = createOnConnectionStateChange({
      dispatchEvent: vi.fn(() => true),
      connection,
      tearDownManager,
    })
    const event = { target: peerConnection } as unknown as Event

    onConnectionStateChange(event)
    onConnectionStateChange(event)

    await vi.waitFor(() => expect(reportClientError).toHaveBeenCalledOnce())
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'engine_webrtc_disconnect',
        dedupeKey: 'engine-webrtc-disconnect:connection-1',
        extra: expect.objectContaining({
          shutdownRoute: 'peer-connection-failed',
          connectionId: 'connection-1',
          modelingApiCallId: 'api-call-1',
          peerConnectionState: 'failed',
          iceConnectionState: 'connected',
          dtlsTransportState: 'failed',
          iceTransportState: 'connected',
          statsCollected: true,
          selectedCandidatePairState: 'succeeded',
          selectedCandidatePairBytesReceived: 100,
          localCandidateType: 'relay',
          localCandidateProtocol: 'udp',
          localCandidateRelayProtocol: 'udp',
          remoteCandidateType: 'host',
          remoteCandidateProtocol: 'udp',
          inboundVideoPacketsReceived: 10,
          inboundVideoPacketsLost: 1,
          inboundVideoFramesDecoded: 20,
        }),
      })
    )
    expect(recordShutdownTrigger).toHaveBeenCalledTimes(2)
    expect(tearDownManager).toHaveBeenCalledTimes(2)
    const serializedReport = JSON.stringify(reportClientError.mock.calls[0])
    expect(serializedReport).not.toContain('203.0.113')
    expect(serializedReport).not.toContain('private-local-fragment')
    expect(serializedReport).not.toContain('private-remote-fragment')
  })

  it('reports when the data channel closes before the peer connection', async () => {
    const { connection, peerConnection, recordShutdownTrigger } =
      createTestConnection()
    const tearDownManager = vi.fn()
    const onDataChannelClose = createOnDataChannelClose({
      connection,
      peerConnection,
      unreliableDataChannel: {
        removeEventListener: vi.fn(),
      } as unknown as RTCDataChannel,
      onDataChannelOpen: vi.fn(),
      onDataChannelError: vi.fn(),
      onDataChannelMessage: vi.fn(),
      tearDownManager,
    })
    const onConnectionStateChange = createOnConnectionStateChange({
      dispatchEvent: vi.fn(() => true),
      connection,
      tearDownManager,
    })

    onDataChannelClose()
    onConnectionStateChange({ target: peerConnection } as unknown as Event)

    await vi.waitFor(() => expect(reportClientError).toHaveBeenCalledOnce())
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'engine_webrtc_disconnect',
        extra: expect.objectContaining({
          shutdownRoute: 'data-channel-closed',
        }),
      })
    )
    expect(recordShutdownTrigger).toHaveBeenCalledTimes(2)
    expect(tearDownManager).toHaveBeenCalledTimes(2)
  })
})
