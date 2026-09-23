import {
  getCloudSyncFailureCause,
  getCloudSyncFailureContext,
  withCloudSyncFailureContext,
} from '@src/lib/cloudSync/failureContext'
import { describe, expect, it } from 'vitest'

describe('cloud sync failure context', () => {
  it('preserves Error identity while attaching the innermost typed context', async () => {
    const failure = new TypeError('private runtime details')

    const result = await withCloudSyncFailureContext(
      { stage: 'archive', point: 'parse-project-archive' },
      () =>
        withCloudSyncFailureContext(
          { stage: 'network', point: 'cloud-api-request' },
          () => Promise.reject(failure)
        )
    ).catch((error: unknown) => error)

    expect(result).toBe(failure)
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

    expect(result).toBeInstanceOf(Error)
    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'filesystem',
      point: 'collect-local-project-files',
    })
    expect(getCloudSyncFailureCause(result)).toBe(
      'ENOENT: /private/project/main.kcl'
    )
  })
})
