import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  createKCClient: vi.fn(() => ({ mocked: true })),
  kcCall: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
  reportUserClientError: vi.fn(async () => ({ accepted: true })),
}))

vi.mock('@src/lib/kcClient', () => ({
  createKCClient: mockState.createKCClient,
  kcCall: mockState.kcCall,
}))

vi.mock('@kittycad/lib', () => ({
  users: {
    report_user_client_error: mockState.reportUserClientError,
  },
}))

import {
  ClientErrorCode,
  reportClientError,
  resetReportedClientErrorsForTests,
} from '@src/lib/clientErrors'
import { EngineDebugger } from '@src/lib/debugger'

describe('reportClientError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReportedClientErrorsForTests()
    EngineDebugger.logs = []
    Object.defineProperty(globalThis, '__APP_VERSION__', {
      configurable: true,
      value: 'test-version',
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: undefined,
    })
    window.history.replaceState({}, '', '/modeling?foo=1#editor')
    ;(window as Window & { app?: any }).app = {
      auth: {
        actor: {
          getSnapshot: () => ({
            context: {
              token: 'token-123',
            },
          }),
        },
      },
    }
  })

  it('posts a normalized client error through the kittycad client', async () => {
    await reportClientError({
      code: 'opfs_missing_create_writable',
      errorName: 'MissingBrowserFeature',
      message: 'missing createWritable',
      extra: {
        hasCreateWritable: false,
      },
    })

    expect(mockState.createKCClient).toHaveBeenCalledWith('token-123')
    expect(mockState.reportUserClientError).toHaveBeenCalledWith({
      client: { mocked: true },
      body: {
        client: 'zoo-modeling-app',
        code: 'opfs_missing_create_writable',
        error_name: 'MissingBrowserFeature',
        message: 'missing createWritable',
        release: 'test-version',
        route: '/modeling?foo=1#editor',
        stack: expect.any(String),
      },
    })
    const firstArg = mockState.reportUserClientError.mock.calls
      .flatMap((call) => call)
      .at(0) as { body: { stack: string } } | undefined
    if (!firstArg) {
      throw new Error('Expected report_user_client_error args to be present')
    }
    expect(JSON.parse(firstArg.body.stack)).toMatchObject({
      hasCreateWritable: false,
    })
  })

  it('uses the desktop package version for release when available', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        packageJson: {
          version: '1.4.4',
        },
      },
    })

    await reportClientError({
      code: 'desktop_error',
      message: 'boom',
    })

    expect(mockState.reportUserClientError).toHaveBeenCalledWith({
      client: { mocked: true },
      body: expect.objectContaining({
        release: '1.4.4',
      }),
    })
  })

  it('falls back to the build-time app version when no runtime version exists', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: undefined,
    })

    await reportClientError({
      code: 'web_error',
      message: 'boom',
    })

    expect(mockState.reportUserClientError).toHaveBeenCalledWith({
      client: { mocked: true },
      body: expect.objectContaining({
        release: 'test-version',
      }),
    })
  })

  it('derives name, message, and stack from an Error object', async () => {
    const error = new Error('boom')
    error.name = 'BoomError'

    await reportClientError({
      error,
      code: 'generic_error',
    })

    expect(mockState.reportUserClientError).toHaveBeenCalledWith({
      client: { mocked: true },
      body: expect.objectContaining({
        code: 'generic_error',
        error_name: 'BoomError',
        message: 'boom',
      }),
    })
    const firstArg = mockState.reportUserClientError.mock.calls
      .flatMap((call) => call)
      .at(0) as { body: { stack: string } } | undefined
    if (!firstArg) {
      throw new Error('Expected report_user_client_error args to be present')
    }
    expect(JSON.parse(firstArg.body.stack)).toMatchObject({
      runtimeStack: expect.any(String),
    })
  })

  it('deduplicates reports when given a dedupe key', async () => {
    await reportClientError({
      code: 'opfs_missing_create_writable',
      message: 'missing createWritable',
      dedupeKey: 'opfs_missing_create_writable',
    })
    await reportClientError({
      code: 'opfs_missing_create_writable',
      message: 'missing createWritable',
      dedupeKey: 'opfs_missing_create_writable',
    })

    expect(mockState.reportUserClientError).toHaveBeenCalledTimes(1)
  })

  it.each([
    ClientErrorCode.EngineDisconnect,
    ClientErrorCode.EngineBackendDisconnect,
  ])('attaches recent engine diagnostics to %s reports', async (code) => {
    EngineDebugger.addLog({
      label: 'onConnectionStateChange',
      message: 'connectionstatechange',
      metadata: { connectionState: 'failed' },
    })
    const expectedSnapshot = EngineDebugger.snapshotForReport()
    await reportClientError({ code, message: 'Engine disconnected' })
    EngineDebugger.addLog({ label: 'connection', message: 'reconnecting' })

    expect(mockState.reportUserClientError).toHaveBeenCalledWith({
      client: { mocked: true },
      body: expect.objectContaining({
        code,
        stack: JSON.stringify({
          engineDebugger: expectedSnapshot,
          userAgent: navigator.userAgent,
        }),
      }),
    })
  })

  it('does not collect engine logs for unrelated errors or duplicate reports', async () => {
    const snapshotSpy = vi.spyOn(EngineDebugger, 'snapshotForReport')
    try {
      await reportClientError({ code: ClientErrorCode.AuthGetUserError })
      expect(snapshotSpy).not.toHaveBeenCalled()
      const report = {
        code: ClientErrorCode.EngineDisconnect,
        dedupeKey: 'engine-disconnect',
      }
      await reportClientError(report)
      await reportClientError(report)
      expect(snapshotSpy).toHaveBeenCalledTimes(1)
      expect(mockState.reportUserClientError).toHaveBeenCalledTimes(2)
    } finally {
      snapshotSpy.mockRestore()
    }
  })
})
