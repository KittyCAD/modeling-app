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
  reportClientError,
  resetReportedClientErrorsForTests,
} from '@src/lib/clientErrors'

describe('reportClientError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReportedClientErrorsForTests()
    Object.defineProperty(globalThis, '__APP_VERSION__', {
      configurable: true,
      value: 'test-version',
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
})
