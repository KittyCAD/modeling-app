import fc from 'fast-check'
import {
  clearSessionExpiredNotice,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import {
  type CloudApiError,
  createRemoteProject,
  downloadRemoteProjectArchive,
  getRemoteProject,
  getRemoteProjectVersion,
  deleteRemoteProject,
  getRemoteProjectThumbnailUrl,
  listRemoteProjects,
  updateRemoteProject,
} from '@src/lib/fs-zds/cloud/api'
import type { ProjectArchiveFile } from '@src/lib/fs-zds/cloud/types'
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  clearSessionExpiredNotice()
})

const encoder = new TextEncoder()

function projectFile(relativePath: string, contents = ''): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

function projectFiles() {
  return [
    projectFile('main.kcl'),
    projectFile(
      'project.toml',
      'title = "bracket"\ndefault_file = "main.kcl"\n'
    ),
  ]
}

async function uploadBodyFromRequest(init?: RequestInit) {
  expect(init?.body).toBeInstanceOf(FormData)
  const bodyPart = (init?.body as FormData).get('body')
  expect(bodyPart).toBeInstanceOf(Blob)
  return JSON.parse(await (bodyPart as Blob).text()) as Record<string, unknown>
}

function projectResponse(projectId: string, revision: string) {
  return new Response(
    JSON.stringify({
      id: projectId,
      title: 'bracket',
      revision,
    }),
    {
      headers: {
        'content-type': 'application/json',
      },
    }
  )
}

describe('cloud upload HTTP contract (mocked fetch)', () => {
  test.each([
    undefined,
    { description: 'A description', category_ids: ['category-a'] },
  ])(
    'creates cloud projects with publication metadata %j',
    async (publicationMetadata) => {
      let uploadedBody: Record<string, unknown> | undefined
      const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
        uploadedBody = await uploadBodyFromRequest(init)
        return projectResponse('project-created', 'rev-1')
      })
      vi.stubGlobal('fetch', fetchMock)

      await createRemoteProject(
        {
          enabled: true,
          baseUrl: 'https://api.dev.zoo.dev',
        },
        '/projects/bracket',
        projectFiles(),
        publicationMetadata
      )

      expect(uploadedBody).toEqual({
        title: 'bracket',
        description: publicationMetadata?.description ?? '',
        category_ids: publicationMetadata?.category_ids ?? [],
        entrypoint_path: 'main.kcl',
        project_toml_path: 'project.toml',
      })
    }
  )

  test('preserves existing publication metadata when updating cloud projects', async () => {
    let uploadedBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      uploadedBody = await uploadBodyFromRequest(init)
      return projectResponse('project-existing', 'rev-2')
    })
    vi.stubGlobal('fetch', fetchMock)

    await updateRemoteProject({
      config: {
        enabled: true,
        baseUrl: 'https://api.dev.zoo.dev',
      },
      projectPath: '/projects/bracket',
      project: {
        id: 'project-existing',
        description: 'Existing Aquarium description.',
        category_ids: ['category-a', 'category-b'],
      },
      files: projectFiles(),
      expectedRevision: 'rev-1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dev.zoo.dev/user/projects/project-existing',
      expect.objectContaining({
        credentials: 'include',
        method: 'PUT',
      })
    )
    expect(uploadedBody).toEqual({
      title: 'bracket',
      description: 'Existing Aquarium description.',
      category_ids: ['category-a', 'category-b'],
      entrypoint_path: 'main.kcl',
      project_toml_path: 'project.toml',
      expected_revision: 'rev-1',
    })
  })

  test('omits deletion intent when no deleted paths are provided', async () => {
    let uploadedBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        uploadedBody = await uploadBodyFromRequest(init)
        return projectResponse('project-existing', 'rev-2')
      })
    )

    await updateRemoteProject({
      config: { enabled: true, baseUrl: 'https://api.dev.zoo.dev' },
      projectPath: '/projects/bracket',
      project: {
        id: 'project-existing',
        description: '',
        category_ids: [],
      },
      files: projectFiles(),
      expectedRevision: 'rev-1',
      deletedPaths: [],
    })

    expect(uploadedBody).not.toHaveProperty('deleted_paths')
  })

  test('declares explicit deletion intent when replacing a cloud project', async () => {
    let uploadedBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        uploadedBody = await uploadBodyFromRequest(init)
        return projectResponse('project-existing', 'rev-2')
      })
    )

    await updateRemoteProject({
      config: { enabled: true, baseUrl: 'https://api.dev.zoo.dev' },
      projectPath: '/projects/bracket',
      project: {
        id: 'project-existing',
        description: '',
        category_ids: [],
      },
      files: projectFiles(),
      expectedRevision: 'rev-1',
      deletedPaths: ['old/part.kcl', 'obsolete.kcl', 'obsolete.kcl'],
    })

    expect(uploadedBody?.deleted_paths).toEqual([
      'obsolete.kcl',
      'old/part.kcl',
    ])
  })
})

describe('cloud thumbnail HTTP contract (mocked fetch)', () => {
  test('fetches protected Zoo thumbnail URLs with cloud auth', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          'content-type': 'image/png',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      getRemoteProjectThumbnailUrl(
        {
          enabled: true,
          baseUrl: 'https://api.dev.zoo.dev',
          token: 'token-123',
        },
        {
          id: '70cc6d47-b316-47ca-ab5c-30b46373b7d0',
        }
      )
    ).resolves.toBe('data:image/png;base64,AQID')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dev.zoo.dev/user/projects/70cc6d47-b316-47ca-ab5c-30b46373b7d0/thumbnail',
      expect.objectContaining({
        credentials: 'include',
      })
    )
    const requestInit = fetchMock.mock.calls[0][1]
    expect(new Headers(requestInit?.headers).get('Authorization')).toBe(
      'Bearer token-123'
    )
  })

  test('preserves retry-after delays on API failures', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        statusText: 'Too Many Requests',
        headers: {
          'content-type': 'application/json',
          'retry-after': '7',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listRemoteProjects({
        enabled: true,
        baseUrl: 'https://api.dev.zoo.dev',
      })
    ).rejects.toMatchObject({
      status: 429,
      message: 'Too many requests',
      retryAfterMs: 7000,
    } satisfies Partial<CloudApiError>)
  })
})

describe('cloud project inventory contract (SDK with mocked fetch)', () => {
  const config = {
    enabled: true,
    baseUrl: 'https://example.test',
    token: 'test-token',
  }

  test('returns the complete inventory without truncating or changing it', async () => {
    const inventory = Array.from({ length: 150 }, (_, index) => ({
      id: `project-${index}`,
    }))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: inventory.slice(0, 100),
          next_page: 'remaining',
        })
      )
      .mockResolvedValueOnce(
        Response.json({ items: inventory.slice(100), next_page: null })
      )
    vi.stubGlobal('fetch', fetchMock)
    const beforeRequest = vi.fn(async () =>
      expect(fetchMock).not.toHaveBeenCalled()
    )
    await expect(listRemoteProjects(config, beforeRequest)).resolves.toEqual(
      inventory
    )
    expect(beforeRequest).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://example.test/user/projects',
      'https://example.test/user/projects?page_token=remaining',
    ])
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({ credentials: 'include' })
    }
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')
    ).toBe('Bearer test-token')
  })

  test('does not publish a partial inventory when a later page fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ items: [{ id: 'one' }], next_page: 'remaining' })
        )
        .mockResolvedValueOnce(
          Response.json({ message: 'Unavailable' }, { status: 503 })
        )
    )
    await expect(listRemoteProjects(config)).rejects.toMatchObject({
      status: 503,
    })
  })

  test.each(['success', 'failure'] as const)(
    'keeps inventory pending for seven seconds before %s',
    async (outcome) => {
      vi.useFakeTimers()
      try {
        const gate = Promise.withResolvers<Response>()
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockReturnValueOnce(gate.promise)
        vi.stubGlobal('fetch', fetchMock)
        const resolved = vi.fn()
        const rejected = vi.fn()
        const pending = listRemoteProjects(config).then(resolved, rejected)
        await vi.advanceTimersByTimeAsync(7000)
        expect(resolved).not.toHaveBeenCalled()
        expect(rejected).not.toHaveBeenCalled()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        gate.resolve(
          outcome === 'success'
            ? Response.json({ items: [{ id: 'one' }], next_page: null })
            : Response.json({ message: 'Unavailable' }, { status: 503 })
        )
        await pending
        if (outcome === 'success') {
          expect(resolved).toHaveBeenCalledExactlyOnceWith([{ id: 'one' }])
          expect(rejected).not.toHaveBeenCalled()
        } else {
          expect(rejected).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ status: 503 })
          )
          expect(resolved).not.toHaveBeenCalled()
        }
      } finally {
        vi.useRealTimers()
      }
    }
  )

  test.each([
    null,
    {},
    [],
    { items: [null], next_page: null },
    { items: [{ title: 'missing id' }], next_page: null },
  ])(
    'rejects malformed inventory rather than exposing an empty catalog: %j',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(body))
      )
      await expect(listRemoteProjects(config)).rejects.toMatchObject({
        message: expect.stringMatching(
          /Invalid (remote project|paginated response)/
        ),
        context: expect.objectContaining({ stage: 'network' }),
      })
    }
  )
})

describe('cloud SDK response boundary', () => {
  const config = {
    enabled: true,
    baseUrl: 'https://example.test',
    token: 'test-token',
  }

  test('downloads archive bytes without JSON coercion', async () => {
    const bytes = new Uint8Array([0, 255, 80, 75, 3, 4])
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(bytes))
    vi.stubGlobal('fetch', fetchMock)
    expect(
      new Uint8Array(
        await downloadRemoteProjectArchive(config, 'one', 'revision-1')
      )
    ).toEqual(bytes)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/user/projects/one/versions/revision-1/download?format=zip',
      expect.objectContaining({ method: 'GET' })
    )
  })

  test('reads metadata and handles empty delete responses through the SDK', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ id: 'one', revision: 'revision-2' })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getRemoteProject(config, 'one')).resolves.toMatchObject({
      id: 'one',
      revision: 'revision-2',
    })
    await expect(deleteRemoteProject(config, 'one')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      'GET',
      'DELETE',
    ])
  })

  test('reports an absent thumbnail without hiding other HTTP failures', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ message: 'Missing' }, { status: 404 })
      )
      .mockResolvedValueOnce(
        Response.json({ message: 'Unavailable' }, { status: 503 })
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      getRemoteProjectThumbnailUrl(config, { id: 'one' })
    ).resolves.toBeUndefined()
    await expect(
      getRemoteProjectThumbnailUrl(config, { id: 'one' })
    ).rejects.toMatchObject({ status: 503 })
  })

  test('rejects unexpected thumbnail payloads instead of guessing their encoding', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ base64: 'AQID' }))
    )
    await expect(
      getRemoteProjectThumbnailUrl(config, { id: 'one' })
    ).rejects.toMatchObject({
      context: { stage: 'network', point: 'parse-cloud-api-response' },
    })
  })
})

describe('SDK multipart and session invariants', () => {
  const config = {
    enabled: true,
    baseUrl: 'https://api.dev.zoo.dev',
    token: 'test-token',
  }

  test('preserves arbitrary binary bytes and Unicode filenames through SDK multipart uploads', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('a', 'Z', 'é', '空', '😀', ' '), {
          minLength: 1,
          maxLength: 15,
        }),
        fc.uint8Array({ maxLength: 1024 }),
        async (characters, bytes) => {
          const name = `assets/${characters.join('')}.bin`
          vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>(async (_input, init) => {
              expect(init?.body).toBeInstanceOf(FormData)
              if (!(init?.body instanceof FormData))
                throw new Error('Missing multipart upload')
              const asset = init.body.get(name)
              expect(asset).toBeInstanceOf(File)
              if (!(asset instanceof File))
                throw new Error('Missing uploaded asset')
              expect(new Uint8Array(await asset.arrayBuffer())).toEqual(bytes)
              return projectResponse('one', 'revision-2')
            })
          )
          await createRemoteProject(config, '/projects/bracket', [
            ...projectFiles(),
            { relativePath: name, data: bytes },
          ])
        }
      ),
      { numRuns: 100 }
    )
  })

  test('preserves conflicts and deletion intent without retrying a stale upload', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(await uploadBodyFromRequest(init)).toMatchObject({
        expected_revision: 'revision-1',
        deleted_paths: ['obsolete.kcl'],
      })
      return Response.json({ message: 'Stale revision' }, { status: 409 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      updateRemoteProject({
        config,
        projectPath: '/projects/bracket',
        project: { id: 'one', description: '', category_ids: [] },
        files: projectFiles(),
        expectedRevision: 'revision-1',
        deletedPaths: ['obsolete.kcl'],
      })
    ).rejects.toMatchObject({ status: 409, message: 'Stale revision' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  test('notifies the app when an SDK request receives an expired session', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ message: 'Expired' }, { status: 401 })
        )
    )
    await expect(getRemoteProject(config, 'one')).rejects.toMatchObject({
      status: 401,
    })
    expect(sessionExpiredNotice.value?.source).toBe('fetch')
  })
})

describe('versioned project download contract', () => {
  const config = {
    enabled: true,
    baseUrl: 'https://api.dev.zoo.dev',
    token: 'test-token',
  }

  test('selects exact file IDs within an immutable version and preserves authentication', async () => {
    const bytes = new Uint8Array([0, 255])
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(bytes))
    vi.stubGlobal('fetch', fetchMock)
    expect(
      new Uint8Array(
        await downloadRemoteProjectArchive(config, 'one', 'version-old', [
          'file-a',
          'file-b',
        ])
      )
    ).toEqual(bytes)
    const [url, init] = fetchMock.mock.calls[0]
    const target = new URL(String(url))
    expect(target.pathname).toBe(
      '/user/projects/one/versions/version-old/download'
    )
    expect(target.searchParams.get('file_ids')).toBe('file-a,file-b')
    expect(target.searchParams.get('format')).toBe('zip')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer test-token'
    )
    expect(init?.credentials).toBe('include')
  })

  test('uses version metadata and keeps project identity separate from version identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({
          id: 'version-2',
          title: 'New title',
          description: 'Description',
          entrypoint_path: 'parts/start.kcl',
          project_toml_path: 'project.toml',
          files: [
            {
              id: 'new-file-id',
              relative_path: 'parts/start.kcl',
              byte_size: 7,
            },
          ],
        })
      )
    )
    await expect(
      getRemoteProjectVersion(
        config,
        { id: 'one', revision: 'old', category_ids: ['category'] },
        'version-2'
      )
    ).resolves.toMatchObject({
      id: 'one',
      revision: 'version-2',
      category_ids: ['category'],
      entrypoint_path: 'parts/start.kcl',
      files: [{ id: 'new-file-id' }],
    })
  })

  test('rejects a missing revision or empty selection without sending a request', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      downloadRemoteProjectArchive(config, 'one', '')
    ).rejects.toThrow('missing its revision')
    await expect(
      downloadRemoteProjectArchive(config, 'one', 'version', [])
    ).rejects.toThrow('at least one file ID')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('propagates an invalid version selection without retrying the current project download', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          error_code: 'InvalidProjectFileSelection',
          message: 'File is absent from this version',
        },
        { status: 400 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      downloadRemoteProjectArchive(config, 'one', 'version', ['missing'])
    ).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

test('passes cancellation through metadata and archive requests', async () => {
  const controller = new AbortController()
  const fetchMock = vi.fn<typeof fetch>(async () =>
    projectResponse('one', 'revision')
  )
  vi.stubGlobal('fetch', fetchMock)
  const config = { enabled: true, baseUrl: 'https://api.dev.zoo.dev' }
  await getRemoteProject(config, 'one', controller.signal)
  await downloadRemoteProjectArchive(
    config,
    'one',
    'rev-1',
    undefined,
    controller.signal
  )
  expect(fetchMock.mock.calls.map(([, init]) => init?.signal)).toEqual([
    controller.signal,
    controller.signal,
  ])
})
