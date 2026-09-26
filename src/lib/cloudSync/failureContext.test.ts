import {
  CloudSyncError,
  getCloudSyncFailureCause,
  getCloudSyncFailureContext,
  withCloudSyncFailureContext,
} from '@src/lib/cloudSync/failureContext'
import { describe, expect, it } from 'vitest'

describe('cloud sync failure context', () => {
  it('wraps native errors once with the innermost typed context', async () => {
    const failure = new TypeError('private runtime details')

    const result = await withCloudSyncFailureContext(
      { stage: 'archive', point: 'parse-project-archive' },
      () =>
        withCloudSyncFailureContext(
          { stage: 'network', point: 'cloud-api-request' },
          () => Promise.reject(failure)
        )
    ).catch((error: unknown) => error)

    expect(result).toBeInstanceOf(CloudSyncError)
    expect(result).not.toBe(failure)
    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'network',
      point: 'cloud-api-request',
    })
    expect(getCloudSyncFailureCause(result)).toBe(failure)
  })

  it('carries typed context for primitive filesystem rejections', async () => {
    const result = await withCloudSyncFailureContext(
      { stage: 'filesystem', point: 'collect-local-project-files' },
      () => Promise.reject('ENOENT: /private/project/main.kcl')
    ).catch((error: unknown) => error)

    expect(result).toBeInstanceOf(CloudSyncError)
    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'filesystem',
      point: 'collect-local-project-files',
    })
    expect(getCloudSyncFailureCause(result)).toBe(
      'ENOENT: /private/project/main.kcl'
    )
  })
})
