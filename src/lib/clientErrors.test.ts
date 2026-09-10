import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  createKCClient: vi.fn(() => ({ mocked: true })),
  kcCall: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
  reportUserClientError: vi.fn(
    async (_params: { body: { stack?: string } }) => ({
      accepted: true,
    })
  ),
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
    const expectedSnapshot = EngineDebugger.snapshotForReport(8192)
    await reportClientError({ code, message: 'Engine disconnected' })
    EngineDebugger.addLog({ label: 'connection', message: 'reconnecting' })

    expect(mockState.reportUserClientError).toHaveBeenCalledWith({
      client: { mocked: true },
      body: expect.objectContaining({
        code,
        stack: JSON.stringify({
          userAgent: navigator.userAgent,
          engineDebugger: expectedSnapshot,
        }),
      }),
    })
  })

  it.each([
    ClientErrorCode.EngineDisconnect,
    ClientErrorCode.EngineBackendDisconnect,
  ])(
    'keeps the latest event in %s reports after the API stack limit',
    async (code) => {
      EngineDebugger.logs = Array.from({ length: 200 }, (_, i) => ({
        time: 1789058414000 + i,
        label: 'connection',
        message: i === 199 ? 'latest disconnect event' : `event-${i}`,
        metadata: { id: '9ce59f90-ef78-42b7-a777-a4b268f14bbd' },
        stack: '',
      }))
      const error = new Error('Engine disconnected')
      error.stack = 'runtime stack'.repeat(100)

      await reportClientError({
        code,
        error,
        extra: { source: 'ConnectionStream', connectionId: 'connection-1' },
      })

      const stack =
        mockState.reportUserClientError.mock.calls[0]?.[0].body.stack
      if (!stack) throw new Error('Expected a reported stack')
      // Match the API's truncate_to_chars(stack, MAX_STACK_LEN).
      const persistedStack = Array.from(stack.trim()).slice(0, 8192).join('')
      expect(stack.length).toBeLessThanOrEqual(8192)
      expect(persistedStack).toBe(stack)
      expect(JSON.parse(persistedStack)).toMatchObject({
        runtimeStack: error.stack,
        source: 'ConnectionStream',
        connectionId: 'connection-1',
        userAgent: navigator.userAgent,
        engineDebugger: {
          totalLogCount: 200,
          truncated: true,
          logs: expect.arrayContaining([
            expect.objectContaining({ message: 'latest disconnect event' }),
          ]),
        },
      })
      expect(stack).not.toContain('"message":"event-0"')
    }
  )

  it.each(['\u{1f680}', '\u0000'])(
    'fits oversized context and escaped logs into the API limit (%j)',
    async (character) => {
      const oversized = character.repeat(10_000)
      const error = new Error('Engine disconnected')
      error.stack = oversized
      EngineDebugger.addLog({
        label: `latest-connection-${oversized}`,
        message: `latest disconnect event ${oversized}`,
        metadata: { message: oversized, reason: oversized },
      })

      await reportClientError({
        code: ClientErrorCode.EngineDisconnect,
        error,
        extra: {
          projectName: oversized,
          details: { message: oversized },
          ['key'.repeat(3000)]: 'oversized property name',
          source: 'EngineWebSocket',
          connectionId: 'connection-1',
        },
      })

      const stack =
        mockState.reportUserClientError.mock.calls[0]?.[0].body.stack
      if (!stack) throw new Error('Expected a reported stack')
      const persistedStack = Array.from(stack.trim()).slice(0, 8192).join('')
      expect(stack.length).toBeLessThanOrEqual(8192)
      expect(persistedStack).toBe(stack)
      expect(JSON.parse(persistedStack)).toMatchObject({
        contextTruncated: true,
        source: 'EngineWebSocket',
        connectionId: 'connection-1',
        engineDebugger: {
          totalLogCount: 1,
          truncated: true,
          logs: [
            expect.objectContaining({
              label: expect.stringContaining('latest-connection-'),
              message: expect.stringContaining('latest disconnect event'),
            }),
          ],
        },
      })
    }
  )

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
