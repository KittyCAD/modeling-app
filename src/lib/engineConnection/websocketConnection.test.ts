import { beforeEach, describe, expect, it, vi } from 'vitest'

const reportClientError = vi.hoisted(() => vi.fn())
const notifySessionExpired = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: {
    EngineBackendDisconnect: 'engine_backend_disconnect',
  },
  reportClientError,
}))

vi.mock('@src/lib/sessionExpired', () => ({ notifySessionExpired }))

import {
  type EngineConnectionError,
  EngineConnectionErrorKind,
} from '@src/lib/engineConnection/utils'
import { createOnWebSocketMessage } from '@src/lib/engineConnection/websocketConnection'

const disconnectAll = vi.fn()
const tearDownManager = vi.fn()

const createMessageHandler = (cloudProjectId?: string) =>
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
  })

const dispatchFailureMessage = (message: string) => {
  createMessageHandler()(
    new MessageEvent('message', {
      data: JSON.stringify({
        success: false,
        errors: [{ error_code: 'internal_api', message }],
      }),
    })
  )
}

const dispatchConnectionError = ({
  code,
  detail,
  retryable = false,
  cloudProjectId,
}: {
  code:
    | 'auth_token_invalid'
    | 'insufficient_scope'
    | 'missing_payment_method'
    | 'too_many_connections'
    | 'backend_disconnected'
  detail: string
  retryable?: boolean
  cloudProjectId?: string
}) => {
  createMessageHandler(cloudProjectId)(
    new MessageEvent('message', {
      data: JSON.stringify({
        success: false,
        request_id: 'request-123',
        connection_error: { code, detail, retryable },
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
    expect(notifySessionExpired).not.toHaveBeenCalled()
    expect(disconnectAll).not.toHaveBeenCalled()
  })

  it('handles a typed backend disconnect and reports its cloud project ID', () => {
    dispatchConnectionError({
      code: 'backend_disconnected',
      detail: 'backend disconnected',
      cloudProjectId: 'cloud-project-123',
    })

    const connectionError: EngineConnectionError = {
      kind: EngineConnectionErrorKind.BackendDisconnect,
      message: 'backend disconnected',
      terminal: true,
    }
    expect(reportClientError).toHaveBeenCalledWith({
      code: 'engine_backend_disconnect',
      message: 'backend disconnected',
      extra: {
        source: 'EngineWebSocket',
        errorCode: 'backend_disconnected',
        requestId: 'request-123',
        cloudProjectId: 'cloud-project-123',
      },
    })
    expect(tearDownManager).toHaveBeenCalledWith({
      websocketClosed: true,
      connectionError,
    })
    expect(disconnectAll).not.toHaveBeenCalled()
  })

  it('handles typed invalid authorization tokens', () => {
    dispatchConnectionError({
      code: 'auth_token_invalid',
      detail: 'The authorization token is invalid.',
    })

    const connectionError: EngineConnectionError = {
      kind: EngineConnectionErrorKind.AuthTokenInvalid,
      message: 'The authorization token is invalid.',
      terminal: true,
    }
    expect(notifySessionExpired).toHaveBeenCalledWith('engine-websocket')
    expect(tearDownManager).toHaveBeenCalledWith({
      websocketClosed: true,
      connectionError,
    })
  })

  it.each([
    ['insufficient_scope', EngineConnectionErrorKind.InsufficientScope],
    ['missing_payment_method', EngineConnectionErrorKind.AccessDenied],
    ['too_many_connections', EngineConnectionErrorKind.TooManyConnections],
  ] as const)('classifies typed %s connection errors', (code, kind) => {
    dispatchConnectionError({ code, detail: 'connection denied' })

    expect(tearDownManager).toHaveBeenCalledWith({
      websocketClosed: true,
      connectionError: {
        kind,
        message: 'connection denied',
        terminal: true,
      },
    })
  })

  it('does not tear down for a typed retryable connection error', () => {
    dispatchConnectionError({
      code: 'backend_disconnected',
      detail: 'temporarily unavailable',
      retryable: true,
    })

    expect(tearDownManager).not.toHaveBeenCalled()
  })
})
