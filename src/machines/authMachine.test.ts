import type * as ClientErrorsModule from '@src/lib/clientErrors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  reportClientError: vi.fn(),
}))

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return {
    ...actual,
    reportClientError: mockState.reportClientError,
  }
})

import { ClientErrorCode } from '@src/lib/clientErrors'
import { reportAuthClientError } from '@src/machines/authMachine'

describe('reportAuthClientError', () => {
  beforeEach(() => {
    mockState.reportClientError.mockClear()
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  it('posts normalized auth client error metadata without tokens', () => {
    const error = new Error('token read failed')

    reportAuthClientError({
      code: ClientErrorCode.AuthTokenSyncError,
      error,
      dedupeKeyPrefix: 'AuthMachine:token-sync',
      extra: {
        hasInputToken: false,
        environment: 'zoo.dev',
      },
    })

    expect(mockState.reportClientError).toHaveBeenCalledWith({
      code: ClientErrorCode.AuthTokenSyncError,
      message: 'token read failed',
      error,
      dedupeKey: 'AuthMachine:token-sync:token read failed',
      extra: {
        source: 'AuthMachine',
        hasInputToken: false,
        environment: 'zoo.dev',
        online: true,
      },
    })
  })

  it('suppresses selected auth reports while offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    reportAuthClientError({
      code: ClientErrorCode.AuthGetUserError,
      error: new Error('network failed'),
      dedupeKeyPrefix: 'AuthMachine:get-user',
      suppressWhenOffline: true,
    })

    expect(mockState.reportClientError).not.toHaveBeenCalled()
  })
})
