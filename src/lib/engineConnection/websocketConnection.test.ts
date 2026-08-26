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
import {
  createOnWebSocketClose,
  createOnWebSocketMessage,
} from '@src/lib/engineConnection/websocketConnection'

const setConnectionError = vi.fn()
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
    setConnectionError,
    tearDownManager,
  })

const dispatchFailureMessage = (
  message: string,
  cloudProjectId?: string,
  errorCode = 'internal_api'
) => {
  createMessageHandler(cloudProjectId)(
    new MessageEvent('message', {
      data: JSON.stringify({
        success: false,
        errors: [{ error_code: errorCode, message }],
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

    expect(setConnectionError).not.toHaveBeenCalled()
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it('keeps other bad request failures retryable', () => {
    dispatchFailureMessage(
      'Unable to acquire a session.',
      undefined,
      'bad_request'
    )

    expect(setConnectionError).not.toHaveBeenCalled()
    expect(tearDownManager).not.toHaveBeenCalled()
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
    expect(setConnectionError).toHaveBeenCalledWith(connectionError)
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
    expect(setConnectionError).toHaveBeenCalledWith(connectionError)
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

    expect(setConnectionError).toHaveBeenCalledWith({
      kind,
      message: 'connection denied',
      terminal: true,
    })
  })

  it('does not tear down for a typed retryable connection error', () => {
    dispatchConnectionError({
      code: 'backend_disconnected',
      detail: 'temporarily unavailable',
      retryable: true,
    })

    expect(setConnectionError).toHaveBeenCalledWith({
      kind: EngineConnectionErrorKind.BackendDisconnect,
      message: 'temporarily unavailable',
      terminal: false,
    })
    expect(tearDownManager).not.toHaveBeenCalled()
  })
})

describe('createOnWebSocketClose', () => {
  it('includes the classified connection error in manager teardown', () => {
    const connectionError: EngineConnectionError = {
      kind: EngineConnectionErrorKind.BackendDisconnect,
      message: 'backend disconnected',
      terminal: true,
    }
    const tearDownManager = vi.fn()
    const onWebSocketClose = createOnWebSocketClose({
      websocket: {
        removeEventListener: vi.fn(),
      } as unknown as WebSocket,
      onWebSocketOpen: vi.fn(),
      onWebSocketError: vi.fn(),
      onWebSocketMessage: vi.fn(),
      tearDownManager,
      dispatchEvent: vi.fn(() => true),
      getConnectionError: () => connectionError,
    })

    onWebSocketClose(new CloseEvent('close', { code: 1011 }))

    expect(tearDownManager).toHaveBeenCalledWith({
      websocketClosed: true,
      code: '1011',
      connectionError,
    })
  })
})
