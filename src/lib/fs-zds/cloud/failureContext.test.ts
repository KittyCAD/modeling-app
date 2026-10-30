import {
  CloudStorageError,
  getCloudFailureCause,
  getCloudFailureContext,
  withCloudFailureContext,
} from '@src/lib/fs-zds/cloud/failureContext'
import { describe, expect, it } from 'vitest'

describe('cloud storage failure context', () => {
  it('wraps native errors once with the innermost typed context', async () => {
    const failure = new TypeError('private runtime details')

    const result = await withCloudFailureContext(
      { stage: 'archive', point: 'parse-project-archive' },
      () =>
        withCloudFailureContext(
          { stage: 'network', point: 'cloud-api-request' },
          () => Promise.reject(failure)
        )
    ).catch((error: unknown) => error)

    expect(result).toBeInstanceOf(CloudStorageError)
    expect(result).not.toBe(failure)
    expect(getCloudFailureContext(result)).toEqual({
      stage: 'network',
      point: 'cloud-api-request',
    })
    expect(getCloudFailureCause(result)).toBe(failure)
  })

  it('carries typed context for primitive network rejections', async () => {
    const result = await withCloudFailureContext(
      { stage: 'network', point: 'cloud-api-request' },
      () => Promise.reject('ENOENT: /private/project/main.kcl')
    ).catch((error: unknown) => error)

    expect(result).toBeInstanceOf(CloudStorageError)
    expect(getCloudFailureContext(result)).toEqual({
      stage: 'network',
      point: 'cloud-api-request',
    })
    expect(getCloudFailureCause(result)).toBe(
      'ENOENT: /private/project/main.kcl'
    )
  })
})
