import 'fake-indexeddb/auto'
import {
  CloudApiError,
  createRemoteProject,
  downloadRemoteProjectArchive,
  getRemoteProject,
  RemoteProjectArchiveLimitError,
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
import JSZip from 'jszip'
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

  it('stops a project archive download as soon as it exceeds its byte limit', async () => {
    const canceled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(5))
      },
      cancel: canceled,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)))

    await expect(
      downloadRemoteProjectArchive(config, 'remote-project', 10)
    ).rejects.toBeInstanceOf(RemoteProjectArchiveLimitError)
    expect(canceled).toHaveBeenCalledOnce()
  })

  it('checks archive content length before reading the response body', async () => {
    const canceled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel: canceled })
    const response = new Response(stream, {
      headers: { 'Content-Length': '11' },
    })
    const readAll = vi.spyOn(response, 'arrayBuffer')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(
      downloadRemoteProjectArchive(config, 'remote-project', 10)
    ).rejects.toBeInstanceOf(RemoteProjectArchiveLimitError)
    expect(canceled).toHaveBeenCalledOnce()
    expect(readAll).not.toHaveBeenCalled()
  })

  it('returns a bounded archive downloaded in multiple chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)))

    const archive = await downloadRemoteProjectArchive(
      config,
      'remote-project',
      3
    )
    expect(new Uint8Array(archive)).toEqual(new Uint8Array([1, 2, 3]))
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

  it('bounds extracted reference files and skips unrelated archive assets', async () => {
    const zip = new JSZip()
    zip.file('project/main.kcl', 'shape = circle(10)')
    zip.file('project/render.png', 'x'.repeat(8 * 1024 * 1024))
    const archive = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
    })
    const limits = {
      includePath: (path: string) => path.endsWith('.kcl'),
      maxArchiveEntries: 4_000,
      maxFileBytes: 256 * 1024,
      maxFiles: 2_000,
      maxTotalBytes: 32 * 1024 * 1024,
    }

    const files = await parseProjectArchive(archive, limits)
    expect(files.map((file) => file.relativePath)).toEqual(['main.kcl'])
    expect(new TextDecoder().decode(files[0].data)).toBe('shape = circle(10)')

    const oversized = new JSZip()
    oversized.file('project/main.kcl', 'x'.repeat(1024 * 1024))
    const oversizedArchive = await oversized.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
    })
    await expect(parseProjectArchive(oversizedArchive, limits)).rejects.toThrow(
      'Project archive is too large.'
    )
  })

  it('caps the count and combined size of selected archive files', async () => {
    const zip = new JSZip()
    zip.file('project/first.kcl', '12345678')
    zip.file('project/second.kcl', '12345678')
    const archive = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
    })
    const limits = {
      includePath: (path: string) => path.endsWith('.kcl'),
      maxArchiveEntries: 4_000,
      maxFileBytes: 10,
      maxFiles: 1,
      maxTotalBytes: 10,
    }

    await expect(parseProjectArchive(archive, limits)).rejects.toThrow(
      'Too many project files.'
    )
    await expect(
      parseProjectArchive(archive, { ...limits, maxFiles: 2 })
    ).rejects.toThrow('Project archive is too large.')
  })

  it('rejects excessive unrelated ZIP entries before JSZip loads them', async () => {
    const zip = new JSZip()
    for (let index = 0; index < 20; index += 1) {
      zip.file(`project/asset-${index}.png`, '')
    }
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    const directory = new DataView(archive)
    directory.setUint16(archive.byteLength - 22 + 8, 1, true)
    directory.setUint16(archive.byteLength - 22 + 10, 1, true)
    const load = vi.spyOn(JSZip, 'loadAsync')

    try {
      await expect(
        parseProjectArchive(archive, {
          includePath: (path) => path.endsWith('.kcl'),
          maxArchiveEntries: 10,
          maxFileBytes: 256 * 1024,
          maxFiles: 2_000,
          maxTotalBytes: 32 * 1024 * 1024,
        })
      ).rejects.toThrow('archive entries')
      expect(load).not.toHaveBeenCalled()
    } finally {
      load.mockRestore()
    }
  })

  it('preserves JSON archive support for limited reference reads', async () => {
    const archive = new TextEncoder().encode(
      JSON.stringify({
        files: [
          {
            relativePath: 'main.kcl',
            contents: 'cube = [1, 2] // "quoted"',
            metadata: { labels: ['[', ',', ']'] },
          },
        ],
      })
    ).buffer

    const files = await parseProjectArchive(archive, {
      includePath: (path) => path.endsWith('.kcl'),
      maxArchiveEntries: 10,
      maxFileBytes: 256 * 1024,
      maxFiles: 2_000,
      maxTotalBytes: 32 * 1024 * 1024,
    })
    expect(files.map((file) => file.relativePath)).toEqual(['main.kcl'])
    expect(new TextDecoder().decode(files[0].data)).toBe(
      'cube = [1, 2] // "quoted"'
    )
  })

  it('rejects excessive unrelated JSON entries', async () => {
    const archive = new TextEncoder().encode(
      JSON.stringify({
        files: Array.from({ length: 20 }, (_, index) => ({
          relativePath: `asset-${index}.png`,
          contents: 'x',
        })),
      })
    ).buffer

    await expect(
      parseProjectArchive(archive, {
        includePath: (path) => path.endsWith('.kcl'),
        maxArchiveEntries: 10,
        maxFileBytes: 256 * 1024,
        maxFiles: 2_000,
        maxTotalBytes: 32 * 1024 * 1024,
      })
    ).rejects.toThrow('Too many archive entries.')
  })

  it('rejects a huge JSON files array before parsing it', async () => {
    const archive = new TextEncoder().encode(
      `{"files":[${'0,'.repeat(100_000).slice(0, -1)}]}`
    ).buffer
    const parse = vi.spyOn(JSON, 'parse')
    try {
      await expect(
        parseProjectArchive(archive, {
          includePath: (path) => path.endsWith('.kcl'),
          maxArchiveEntries: 4_000,
          maxFileBytes: 256 * 1024,
          maxFiles: 2_000,
          maxTotalBytes: 32 * 1024 * 1024,
        })
      ).rejects.toThrow('Too many archive entries.')
      expect(parse).not.toHaveBeenCalled()
    } finally {
      parse.mockRestore()
    }
  })

  it('bounds JSON metadata objects before parsing them', async () => {
    const archive = new TextEncoder().encode(
      JSON.stringify({
        files: [],
        metadata: Object.fromEntries(
          Array.from({ length: 100 }, (_, index) => [`key${index}`, index])
        ),
      })
    ).buffer
    const parse = vi.spyOn(JSON, 'parse')
    try {
      await expect(
        parseProjectArchive(archive, {
          includePath: () => true,
          maxArchiveEntries: 10,
          maxFileBytes: 256 * 1024,
          maxFiles: 2_000,
          maxTotalBytes: 32 * 1024 * 1024,
        })
      ).rejects.toThrow('Archive JSON is too complex.')
      expect(parse).not.toHaveBeenCalled()
    } finally {
      parse.mockRestore()
    }
  })

  it('skips unrelated JSON contents before checking selected file sizes', async () => {
    const archive = new TextEncoder().encode(
      JSON.stringify({
        files: [
          { relativePath: 'render.png', contents: 'x'.repeat(100) },
          { relativePath: 'main.kcl', contents: 'cube = 1' },
        ],
      })
    ).buffer
    const limits = {
      includePath: (path: string) => path.endsWith('.kcl'),
      maxArchiveEntries: 10,
      maxFileBytes: 10,
      maxFiles: 2,
      maxTotalBytes: 10,
    }

    const files = await parseProjectArchive(archive, limits)
    expect(files.map((file) => file.relativePath)).toEqual(['main.kcl'])
    await expect(
      parseProjectArchive(
        new TextEncoder().encode(
          JSON.stringify({
            files: [{ relativePath: 'main.kcl', contents: 'x'.repeat(11) }],
          })
        ).buffer,
        limits
      )
    ).rejects.toThrow('Project archive is too large.')
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
