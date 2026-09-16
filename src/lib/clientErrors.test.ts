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
  ])(
    'preserves engine log data except per-entry stacks for %s',
    async (code) => {
      const metadata = {
        candidate: {
          toJSON: () => ({ candidate: 'relay candidate', sdpMLineIndex: 0 }),
        },
        command: { type: 'example', values: [1, { arbitraryField: true }] },
        jsAppSettings: { theme: 'dark' },
        filePath: '/project/main.kcl',
        longValue: 'x'.repeat(1500),
        event: new Event('close'),
      }
      const log = {
        time: 1789058414000,
        message: 'icecandidate',
        label: 'onIceCandidate',
        metadata,
      }
      EngineDebugger.logs = [{ ...log, stack: 'per-entry stack' }]
      const expected = JSON.stringify({
        userAgent: navigator.userAgent,
        engineDebugger: [log],
      })

      await reportClientError({ code, message: 'Engine disconnected' })
      metadata.command.values.push(2)

      expect(mockState.reportUserClientError).toHaveBeenCalledWith({
        client: { mocked: true },
        body: expect.objectContaining({ code, stack: expected }),
      })
      expect(EngineDebugger.logs[0].stack).toBe('per-entry stack')
    }
  )

  it.each(['x', '\u{1f680}', '\u0000'])(
    'only crops the serialized report at the API character limit (%j)',
    async (character) => {
      const log = {
        time: 1789058414000,
        message: 'closed',
        label: 'connection',
        metadata: { payload: character.repeat(10_000) },
      }
      EngineDebugger.logs = [{ ...log, stack: 'per-entry stack' }]
      const serialized = JSON.stringify({
        source: 'EngineWebSocket',
        userAgent: navigator.userAgent,
        engineDebugger: [log],
      })

      await reportClientError({
        code: ClientErrorCode.EngineDisconnect,
        extra: { source: 'EngineWebSocket' },
      })

      const stack =
        mockState.reportUserClientError.mock.calls[0]?.[0].body.stack
      if (!stack) throw new Error('Expected a reported stack')
      expect(stack).toBe(Array.from(serialized).slice(0, 8192).join(''))
      expect(Array.from(stack)).toHaveLength(8192)
      // Cropping deliberately permits a partial JSON document in stack.
      expect(() => JSON.parse(stack)).toThrow()
    }
  )

  it.each([
    ClientErrorCode.EngineDisconnect,
    ClientErrorCode.EngineBackendDisconnect,
  ])('keeps recent events when history overflows for %s', async (code) => {
    const previousConnections = Array.from({ length: 100 }, (_, index) => ({
      time: index,
      message: `Previous connection ${index}`,
      stack: 'per-entry stack',
      label: 'connection',
      metadata: { connectionId: index, detail: 'x'.repeat(100) },
    }))
    const failed = {
      time: 100,
      message: 'ICE connection failed',
      label: 'connection',
      metadata: { connectionId: 100, iceConnectionState: 'failed' },
    }
    const disconnected = {
      time: 101,
      message: 'Current connection disconnected',
      label: 'connection',
      metadata: { connectionId: 100 },
    }
    EngineDebugger.logs = [
      ...previousConnections,
      { ...failed, stack: 'failure stack' },
      { ...disconnected, stack: 'disconnect stack' },
    ]
    const originalLogs = [...EngineDebugger.logs]

    await reportClientError({ code })

    const stack = mockState.reportUserClientError.mock.calls[0]?.[0].body.stack
    if (!stack) throw new Error('Expected a reported stack')
    expect(Array.from(stack)).toHaveLength(8192)
    expect(stack).toContain(
      `"engineDebugger":[${JSON.stringify(disconnected)},${JSON.stringify(failed)},`
    )
    expect(stack).not.toContain('"message":"Previous connection 0"')
    expect(EngineDebugger.logs).toEqual(originalLogs)
  })

  it('still reports the original error when log metadata cannot serialize', async () => {
    const metadata: Record<string, unknown> = {}
    metadata.circular = metadata
    EngineDebugger.addLog({ label: 'connection', message: 'closed', metadata })

    await reportClientError({
      code: ClientErrorCode.EngineDisconnect,
      message: 'Engine disconnected',
      extra: { source: 'ConnectionStream' },
    })

    expect(mockState.reportUserClientError).toHaveBeenCalledWith({
      client: { mocked: true },
      body: expect.objectContaining({
        message: 'Engine disconnected',
        stack: JSON.stringify({
          source: 'ConnectionStream',
          userAgent: navigator.userAgent,
        }),
      }),
    })
  })

  it('does not serialize engine logs for unrelated errors or duplicate reports', async () => {
    const toJSON = vi.fn(() => ({ connectionState: 'failed' }))
    EngineDebugger.addLog({
      label: 'connection',
      message: 'closed',
      metadata: { toJSON },
    })

    await reportClientError({ code: ClientErrorCode.AuthGetUserError })
    expect(toJSON).not.toHaveBeenCalled()
    const report = {
      code: ClientErrorCode.EngineDisconnect,
      dedupeKey: 'engine-disconnect',
    }
    await reportClientError(report)
    await reportClientError(report)
    expect(toJSON).toHaveBeenCalledTimes(1)
    expect(mockState.reportUserClientError).toHaveBeenCalledTimes(2)
  })
})
