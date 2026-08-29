import { beforeEach, describe, expect, it, vi } from 'vitest'

const reportClientError = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: {
    EngineBackendDisconnect: 'engine_backend_disconnect',
  },
  reportClientError,
}))

import { createOnWebSocketMessage } from '@src/lib/engineConnection/websocketConnection'

const createMessageHandler = (cloudProjectId?: string) =>
  createOnWebSocketMessage({
    disconnectAll: vi.fn(),
    setPong: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    ping: vi.fn(),
    setPing: vi.fn(),
    createPeerConnection: vi.fn(),
    send: vi.fn(),
    setSdpAnswer: vi.fn(),
    initiateConnectionExclusive: vi.fn(),
    addIceCandidate: vi.fn(),
    webrtcStatsCollector: vi.fn(),
    sdpAnswerResolve: vi.fn(),
    sdpAnswerReject: vi.fn(),
    setApiCallId: vi.fn(),
    getCloudProjectId: () => cloudProjectId,
    webrtc: true,
    onWebSocketReady: vi.fn(),
  })

const dispatchFailureMessage = (message: string, cloudProjectId?: string) => {
  createMessageHandler(cloudProjectId)(
    new MessageEvent('message', {
      data: JSON.stringify({
        success: false,
        errors: [{ error_code: 'internal_api', message }],
      }),
    })
  )
}

describe('createOnWebSocketMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('reports backend Engine disconnect failures with the cloud project ID', () => {
    dispatchFailureMessage(
      'modeling connection interrupted; please reconnect and retry',
      'cloud-project-123'
    )

    expect(reportClientError).toHaveBeenCalledOnce()
    expect(reportClientError).toHaveBeenCalledWith({
      code: 'engine_backend_disconnect',
      message: 'modeling connection interrupted; please reconnect and retry',
      extra: {
        source: 'EngineWebSocket',
        errorCode: 'internal_api',
        cloudProjectId: 'cloud-project-123',
      },
    })
  })

  it('reports backend Engine disconnect failures for local-only projects', () => {
    dispatchFailureMessage(
      'modeling connection interrupted; please reconnect and retry'
    )

    expect(reportClientError).toHaveBeenCalledWith({
      code: 'engine_backend_disconnect',
      message: 'modeling connection interrupted; please reconnect and retry',
      extra: {
        source: 'EngineWebSocket',
        errorCode: 'internal_api',
      },
    })
  })

  it('does not report other internal API failures as backend disconnects', () => {
    dispatchFailureMessage('modeling service unavailable; please retry')

    expect(reportClientError).not.toHaveBeenCalled()
  })

  it('completes a pong handshake without creating a peer connection when WebRTC is disabled', () => {
    const createPeerConnection = vi.fn()
    const onWebSocketReady = vi.fn()
    const onMessage = createOnWebSocketMessage({
      disconnectAll: vi.fn(),
      setPong: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      ping: vi.fn(),
      setPing: vi.fn(),
      createPeerConnection,
      send: vi.fn(),
      setSdpAnswer: vi.fn(),
      initiateConnectionExclusive: vi.fn(),
      addIceCandidate: vi.fn(),
      webrtcStatsCollector: vi.fn(),
      sdpAnswerResolve: vi.fn(),
      sdpAnswerReject: vi.fn(),
      setApiCallId: vi.fn(),
      getCloudProjectId: () => undefined,
      webrtc: false,
      onWebSocketReady,
    })

    onMessage(
      new MessageEvent('message', {
        data: JSON.stringify({
          success: true,
          request_id: null,
          resp: {
            type: 'pong',
          },
        }),
      })
    )
    onMessage(
      new MessageEvent('message', {
        data: JSON.stringify({
          success: true,
          request_id: null,
          resp: {
            type: 'ice_server_info',
            data: { ice_servers: [] },
          },
        }),
      })
    )

    expect(onWebSocketReady).toHaveBeenCalledOnce()
    expect(createPeerConnection).not.toHaveBeenCalled()
  })
})
