import 'fake-indexeddb/auto'
import {
  CloudApiError,
  createRemoteProject,
  getRemoteProject,
} from '@src/lib/cloudSync/cloudApi'
import {
  CloudSyncError,
  getCloudSyncFailureCause,
  getCloudSyncFailureContext,
} from '@src/lib/cloudSync/failureContext'
import {
  parseProjectArchive,
  projectManifestFromFiles,
} from '@src/lib/cloudSync/projectArchive'
import { getAllOutboxEntries } from '@src/lib/cloudSync/syncDb'
import type { CloudSyncConfig } from '@src/lib/cloudSync/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

const config: CloudSyncConfig = {
  enabled: true,
  baseUrl: 'https://example.test',
  environmentName: 'dev.zoo.dev',
  cloudProjectDirectoryPaths: [],
}

describe('cloud sync failure boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies fetch rejections while preserving their native cause', async () => {
    const failure = new TypeError('Failed to fetch private request')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))

    const result = await getRemoteProject(config, 'remote-project').catch(
      (error: unknown) => error
    )

    expect(result).toBeInstanceOf(CloudSyncError)
    expect(getCloudSyncFailureCause(result)).toBe(failure)
    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'network',
      point: 'cloud-api-request',
    })
  })

  it('distinguishes response decoding from the request itself', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not-json', { status: 200 }))
    )

    const result = await getRemoteProject(config, 'remote-project').catch(
      (error: unknown) => error
    )

    expect(result).toBeInstanceOf(CloudSyncError)
    expect(getCloudSyncFailureCause(result)).toBeInstanceOf(SyntaxError)
    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'network',
      point: 'parse-cloud-api-response',
    })
  })

  it('preserves CloudApiError status handling while classifying requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Private API details' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    const result = await getRemoteProject(config, 'remote-project').catch(
      (error: unknown) => error
    )

    expect(result).toBeInstanceOf(CloudApiError)
    expect(result).toBeInstanceOf(CloudSyncError)
    expect((result as CloudApiError).status).toBe(503)
    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'network',
      point: 'cloud-api-request',
    })
  })

  it('classifies invalid project archives', async () => {
    const result = await parseProjectArchive(
      new TextEncoder().encode('not-an-archive').buffer
    ).catch((error: unknown) => error)

    expect(result).toBeInstanceOf(Error)
    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'archive',
      point: 'parse-project-archive',
    })
  })

  it('classifies project manifest hashing failures', async () => {
    const failure = new TypeError('Private crypto implementation detail')
    vi.stubGlobal('crypto', {
      subtle: { digest: vi.fn().mockRejectedValue(failure) },
    })

    const result = await projectManifestFromFiles([
      {
        relativePath: 'main.kcl',
        data: new TextEncoder().encode('cube = 1'),
      },
    ]).catch((error: unknown) => error)

    expect(result).toBeInstanceOf(CloudSyncError)
    expect(getCloudSyncFailureCause(result)).toBe(failure)
    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'manifest',
      point: 'hash-project-manifest',
    })
  })

  it('classifies project upload preparation failures', async () => {
    const result = await createRemoteProject(config, '/private/project', [
      {
        relativePath: 'main.kcl',
        data: new TextEncoder().encode('cube = 1'),
      },
    ]).catch((error: unknown) => error)

    expect(result).toBeInstanceOf(Error)
    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'archive',
      point: 'prepare-project-upload',
    })
  })

  it('classifies an unavailable sync database at its opening boundary', async () => {
    vi.stubGlobal('indexedDB', undefined)

    const result = await getAllOutboxEntries().catch((error: unknown) => error)

    expect(getCloudSyncFailureContext(result)).toEqual({
      stage: 'database',
      point: 'open-sync-database',
    })
    expect(getCloudSyncFailureCause(result)).toBeInstanceOf(Error)
  })
})
