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
    expect(setConnectionError).toHaveBeenCalledWith({
      kind: EngineConnectionErrorKind.BackendDisconnect,
      message: 'modeling connection interrupted; please reconnect and retry',
      terminal: true,
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

    expect(setConnectionError).not.toHaveBeenCalled()
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it('stops reconnecting when the authorization token is invalid', () => {
    dispatchFailureMessage(
      'The authorization token is invalid.',
      undefined,
      'auth_token_invalid'
    )

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
    expect(disconnectAll).not.toHaveBeenCalled()
  })

  it('stops reconnecting when the user has too many active connections', () => {
    dispatchFailureMessage(
      'Too many active connections, only 2 allowed per user.',
      undefined,
      'bad_request'
    )

    const connectionError: EngineConnectionError = {
      kind: EngineConnectionErrorKind.TooManyConnections,
      message: 'Too many active connections, only 2 allowed per user.',
      terminal: true,
    }
    expect(setConnectionError).toHaveBeenCalledWith(connectionError)
    expect(tearDownManager).toHaveBeenCalledWith({
      websocketClosed: true,
      connectionError,
    })
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
