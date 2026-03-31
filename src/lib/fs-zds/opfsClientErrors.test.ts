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
  reportOPFSClientError,
  resetReportedOPFSClientErrorsForTests,
} from '@src/lib/fs-zds/opfsClientErrors'

describe('reportOPFSClientError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReportedOPFSClientErrorsForTests()
    Object.defineProperty(globalThis, '__APP_VERSION__', {
      configurable: true,
      value: 'test-version',
    })
    window.history.replaceState({}, '', '/modeling?foo=1#editor')
    ;(window as Window & { app?: unknown }).app = {
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

  it('posts the missing feature report through the kittycad client', async () => {
    await reportOPFSClientError({
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
    expect(
      JSON.parse(mockState.reportUserClientError.mock.calls[0][0].body.stack)
    ).toMatchObject({
      hasCreateWritable: false,
    })
  })

  it('deduplicates the same feature report within a session', async () => {
    await reportOPFSClientError({
      code: 'opfs_missing_create_writable',
      errorName: 'MissingBrowserFeature',
      message: 'missing createWritable',
    })
    await reportOPFSClientError({
      code: 'opfs_missing_create_writable',
      errorName: 'MissingBrowserFeature',
      message: 'missing createWritable',
    })

    expect(mockState.reportUserClientError).toHaveBeenCalledTimes(1)
  })
})
