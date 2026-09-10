import { beforeEach, describe, expect, it, vi } from 'vitest'

const reportClientError = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: {
    EngineBackendDisconnect: 'engine_backend_disconnect',
  },
  reportClientError,
}))

import { EngineConnectionErrorKind } from '@src/lib/engineConnection/utils'
import { createOnWebSocketMessage } from '@src/lib/engineConnection/websocketConnection'

const disconnectAll = vi.fn()
const tearDownManager = vi.fn()

const createMessageHandler = (
  cloudProjectId?: string,
  requestReconnect = vi.fn()
) =>
  createOnWebSocketMessage({
    disconnectAll,
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
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('requests reconnection for a reconnect response without reporting a failure', () => {
    const requestReconnect = vi.fn()
    const handler = createMessageHandler(undefined, requestReconnect)
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
  })

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

  it('reports backend Engine disconnect failures with the cloud project ID', () => {
    dispatchFailureMessage(
      'modeling connection interrupted; please reconnect and retry',
      'cloud-project-123'
    )

    expect(reportClientError).toHaveBeenCalledOnce()
    expect(tearDownManager).toHaveBeenCalledWith({
      websocketClosed: true,
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

    expect(tearDownManager).not.toHaveBeenCalled()
    expect(reportClientError).not.toHaveBeenCalled()
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
