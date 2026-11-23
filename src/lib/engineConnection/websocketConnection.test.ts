import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reportClientError = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: {
    EngineBackendDisconnect: 'engine_backend_disconnect',
    EnginePingPongTiming: 'engine_ping_pong_timing',
  },
  reportClientError,
}))

import { EngineConnectionErrorKind } from '@src/lib/engineConnection/utils'
import { createOnWebSocketMessage } from '@src/lib/engineConnection/websocketConnection'

const disconnectAll = vi.fn()
const tearDownManager = vi.fn()
const getConnectionContext = vi.fn()

const createMessageHandler = (
  cloudProjectId?: string,
  requestReconnect = vi.fn(),
  ping = vi.fn(),
  webrtc = true
) =>
  createOnWebSocketMessage({
    disconnectAll,
    setPong: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    ping,
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
    webrtc,
    onWebSocketReady: vi.fn(),
    getConnectionContext,
    tearDownManager,
    requestReconnect,
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
    getConnectionContext.mockReturnValue({
      connectionId: 'local-attempt',
      modelingApiCallId: 'server-session',
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reports the first ping-pong and later ones only when they exceed 10 seconds', () => {
    vi.useFakeTimers()
    const ping = vi.fn()
    const handler = createMessageHandler(undefined, vi.fn(), ping)
    const pong = new MessageEvent('message', {
      data: JSON.stringify({
        success: true,
        request_id: null,
        resp: { type: 'pong', data: {} },
      }),
    })

    // An unsolicited pong does not consume the first completed ping-pong.
    ping.mockReturnValueOnce(undefined)
    handler(pong)
    expect(reportClientError).not.toHaveBeenCalled()

    for (const [now, sentAt] of [
      [1_000, 950],
      [14_000, 4_000],
      [26_001, 16_000],
    ]) {
      vi.setSystemTime(now)
      ping.mockReturnValueOnce(sentAt)
      handler(pong)
    }

    expect(reportClientError).toHaveBeenCalledTimes(2)
    expect(reportClientError).toHaveBeenNthCalledWith(1, {
      code: 'engine_ping_pong_timing',
      message: 'Engine ping-pong timing',
      extra: {
        connectionId: 'local-attempt',
        modelingApiCallId: 'server-session',
        pingPongNumber: 1,
        durationMs: 50,
      },
    })
    expect(reportClientError).toHaveBeenNthCalledWith(2, {
      code: 'engine_ping_pong_timing',
      message: 'Engine ping-pong timing',
      extra: {
        connectionId: 'local-attempt',
        modelingApiCallId: 'server-session',
        pingPongNumber: 3,
        durationMs: 10_001,
      },
    })
  })

  it.each([true, false])(
    'requests reconnection without reporting a failure (webrtc=%s)',
    (webrtc) => {
      const requestReconnect = vi.fn()
      const handler = createMessageHandler(
        undefined,
        requestReconnect,
        undefined,
        webrtc
      )
      handler(
        new MessageEvent('message', {
          data: JSON.stringify({
            success: true,
            request_id: null,
            resp: { type: 'reconnect', data: {} },
          }),
        })
      )
      expect(requestReconnect).toHaveBeenCalledOnce()
      expect(reportClientError).not.toHaveBeenCalled()
    }
  )

  it('does not request reconnection for a pong response', () => {
    const requestReconnect = vi.fn()
    createMessageHandler(
      undefined,
      requestReconnect
    )(
      new MessageEvent('message', {
        data: JSON.stringify({
          success: true,
          request_id: null,
          resp: { type: 'pong', data: {} },
        }),
      })
    )
    expect(requestReconnect).not.toHaveBeenCalled()
  })

  it('reports backend Engine disconnect identity captured before teardown', () => {
    tearDownManager.mockImplementationOnce(() => {
      getConnectionContext.mockReturnValue({
        connectionId: 'replacement-attempt',
        modelingApiCallId: 'replacement-session',
      })
    })
    dispatchFailureMessage(
      'modeling connection interrupted; please reconnect and retry',
      'cloud-project-123'
    )

    expect(reportClientError).toHaveBeenCalledOnce()
    expect(tearDownManager).toHaveBeenCalledWith({
      route: 'backend-shutdown',
      initiatedBy: 'unknown',
      connectionError: {
        kind: EngineConnectionErrorKind.BackendDisconnect,
        message: 'modeling connection interrupted; please reconnect and retry',
        terminal: true,
      },
    })
    expect(reportClientError).toHaveBeenCalledWith({
      code: 'engine_backend_disconnect',
      message: 'modeling connection interrupted; please reconnect and retry',
      extra: {
        connectionId: 'local-attempt',
        modelingApiCallId: 'server-session',
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
        connectionId: 'local-attempt',
        modelingApiCallId: 'server-session',
        source: 'EngineWebSocket',
        errorCode: 'internal_api',
      },
    })
  })

  it('does not report other internal API failures as backend disconnects', () => {
    dispatchFailureMessage('modeling service unavailable; please retry')

    expect(tearDownManager).not.toHaveBeenCalled()
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it('completes a pong handshake without creating a peer connection when WebRTC is disabled', () => {
    const createPeerConnection = vi.fn()
    const onWebSocketReady = vi.fn()
    const requestReconnect = vi.fn()
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
      getConnectionContext,
      tearDownManager,
      requestReconnect,
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

  it('does not throw when a failed response has no error details', () => {
    const handler = createMessageHandler()

    expect(() =>
      handler(
        new MessageEvent('message', {
          data: JSON.stringify({ success: false, errors: [] }),
        })
      )
    ).not.toThrow()
  })

  it('keeps the pre-header auth token missing response non-terminal', () => {
    const handler = createMessageHandler()

    handler(
      new MessageEvent('message', {
        data: JSON.stringify({
          success: false,
          request_id: null,
          errors: [
            {
              error_code: 'auth_token_missing',
              message:
                'Please send `{ headers: { Authorization: "Bearer <token>" } }` over this websocket.',
            },
          ],
        }),
      })
    )

    expect(tearDownManager).not.toHaveBeenCalled()
    expect(disconnectAll).not.toHaveBeenCalled()
  })
})
