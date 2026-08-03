import { CloudApiError } from '@src/lib/cloudSync/cloudApi'
import type * as ClientErrorsModule from '@src/lib/clientErrors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reportClientError: vi.fn<typeof ClientErrorsModule.reportClientError>(
    async () => undefined
  ),
  reportRejection: vi.fn(),
}))

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: {
    CloudSyncConflict: 'cloud_sync_conflict',
    CloudSyncFailure: 'cloud_sync_failure',
  },
  reportClientError: mocks.reportClientError,
}))

vi.mock('@src/lib/trap', () => ({
  reportRejection: mocks.reportRejection,
}))

import {
  reportCloudSyncConflict,
  reportCloudSyncFailure,
} from '@src/lib/cloudSync/clientErrorReporting'

describe('cloud sync client error reporting', () => {
  beforeEach(() => {
    mocks.reportClientError.mockReset()
    mocks.reportClientError.mockResolvedValue(undefined)
    mocks.reportRejection.mockClear()
  })

  it('reports conflicts without project details', () => {
    reportCloudSyncConflict()

    expect(mocks.reportClientError).toHaveBeenCalledWith({
      code: 'cloud_sync_conflict',
      errorName: 'CloudSyncConflict',
      message: 'Cloud sync conflict: local and remote both changed.',
      route: '/cloud-sync',
      extra: {
        source: 'CloudSyncEngine',
        operation: 'reconcile-project',
      },
    })
  })

  it('reports privacy-safe failure categories', () => {
    const firstError = new Error('ENOENT: /projects/one/main.kcl')
    firstError.name = '/projects/private-error-name'
    reportCloudSyncFailure('sync', firstError)
    reportCloudSyncFailure('sync', new Error('ENOENT: /projects/two/main.kcl'))
    reportCloudSyncFailure(
      'sync',
      Object.assign(new Error('Forbidden'), {
        kind: 'remote-upload-forbidden',
      })
    )
    reportCloudSyncFailure(
      'remote-index',
      new Error('Remote index failed', {
        cause: new CloudApiError(503, 'Remote index is unavailable'),
      })
    )

    const [first, second, third, fourth] =
      mocks.reportClientError.mock.calls.map(([report]) => report)
    expect(first.dedupeKey).toBe('CloudSync:failure:sync:Error:none:unknown')
    expect(second.dedupeKey).toBe(first.dedupeKey)
    expect(third).toMatchObject({
      dedupeKey: 'CloudSync:failure:sync:Error:none:remote-upload-forbidden',
      extra: {
        operation: 'sync',
        errorType: 'Error',
        failureKind: 'remote-upload-forbidden',
      },
    })
    expect(fourth).toMatchObject({
      code: 'cloud_sync_failure',
      dedupeKey: 'CloudSync:failure:remote-index:CloudApiError:503:unknown',
      extra: {
        operation: 'remote-index',
        errorType: 'CloudApiError',
        cloudApiStatus: 503,
      },
    })
    expect(fourth.dedupeKey).not.toBe(first.dedupeKey)
    expect(JSON.stringify([first, second, third, fourth])).not.toContain(
      '/projects/'
    )
    expect(JSON.stringify([first, second, third, fourth])).not.toContain(
      'Remote index is unavailable'
    )
  })

  it('does not propagate reporting failures', async () => {
    const rejection = new Error('Client error endpoint unavailable')
    mocks.reportClientError.mockRejectedValueOnce(rejection)

    expect(reportCloudSyncFailure('sync', new Error('Sync failed'))).toBe(
      undefined
    )
    await vi.waitFor(() => {
      expect(mocks.reportRejection).toHaveBeenCalledWith(rejection)
    })
  })
})
