import {
  type CloudApiError,
  createRemoteProject,
  getRemoteProjectThumbnailUrl,
  listRemoteProjects,
  normalizeRemoteProjectThumbnailUrl,
  remoteProjectThumbnailTargetPathFromUrl,
  thumbnailUrlFromRemoteProjectPayload,
  updateRemoteProject,
} from '@src/lib/cloudSync/cloudApi'
import type { ProjectArchiveFile } from '@src/lib/cloudSync/types'
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

const encoder = new TextEncoder()

function projectFile(relativePath: string, contents = ''): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
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

describe('remote project uploads', () => {
  test('includes empty publication metadata defaults when creating cloud projects', async () => {
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
      [projectFile('main.kcl')]
    )

    expect(uploadedBody).toEqual({
      title: 'bracket',
      description: '',
      category_ids: [],
      entrypoint_path: 'main.kcl',
      project_toml_path: 'project.toml',
    })
  })

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
      files: [projectFile('main.kcl')],
      expectedRevision: 'rev-1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dev.zoo.dev/user/projects/project-existing?expected_revision=rev-1',
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
      deleted_paths: [],
    })
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
      files: [projectFile('main.kcl')],
      expectedRevision: 'rev-1',
      deletedPaths: ['old/part.kcl', 'obsolete.kcl', 'obsolete.kcl'],
    })

    expect(uploadedBody?.deleted_paths).toEqual([
      'obsolete.kcl',
      'old/part.kcl',
    ])
  })
})

describe('remote project thumbnail URLs', () => {
  test('normalizes Zoo project thumbnail URLs to the extensionless API route', () => {
    expect(
      normalizeRemoteProjectThumbnailUrl(
        'https://api.dev.zoo.dev/user/projects/70cc6d47-b316-47ca-ab5c-30b46373b7d0/thumbnail.png?size=small#preview'
      )
    ).toBe(
      'https://api.dev.zoo.dev/user/projects/70cc6d47-b316-47ca-ab5c-30b46373b7d0/thumbnail?size=small#preview'
    )
  })

  test('leaves ordinary image URLs alone', () => {
    expect(
      normalizeRemoteProjectThumbnailUrl(
        'https://example.test/assets/remote-123-thumbnail.png'
      )
    ).toBe('https://example.test/assets/remote-123-thumbnail.png')
  })

  test('normalizes thumbnail URLs found in remote project payloads', () => {
    expect(
      thumbnailUrlFromRemoteProjectPayload({
        thumbnail_url:
          'https://api.dev.zoo.dev/user/projects/70cc6d47-b316-47ca-ab5c-30b46373b7d0/thumbnail.png',
      })
    ).toBe(
      'https://api.dev.zoo.dev/user/projects/70cc6d47-b316-47ca-ab5c-30b46373b7d0/thumbnail'
    )
  })

  test('extracts an authenticated fetch target from Zoo project thumbnail URLs', () => {
    expect(
      remoteProjectThumbnailTargetPathFromUrl(
        'https://api.dev.zoo.dev/user/projects/70cc6d47-b316-47ca-ab5c-30b46373b7d0/thumbnail.png?size=small#preview'
      )
    ).toBe(
      '/user/projects/70cc6d47-b316-47ca-ab5c-30b46373b7d0/thumbnail?size=small'
    )
  })

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
          thumbnail_url:
            'https://api.dev.zoo.dev/user/projects/70cc6d47-b316-47ca-ab5c-30b46373b7d0/thumbnail.png',
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
    expect((requestInit?.headers as Headers).get('Authorization')).toBe(
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

describe('remote project pagination', () => {
  const config = {
    enabled: true,
    baseUrl: 'https://example.test',
    token: 'test-token',
  }
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    })

  test('supports the legacy complete array without changing its request URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([{ id: 'one' }]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listRemoteProjects(config)).resolves.toEqual([{ id: 'one' }])
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://example.test/user/projects',
      expect.anything()
    )
  })

  test('loads more than 100 projects and throttles/authenticates every page', async () => {
    const first = Array.from({ length: 100 }, (_, id) => ({
      id: `project-${id}`,
    }))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: first, next_page: 'a+/=?&' }))
      .mockResolvedValueOnce(json({ items: [{ id: 'last' }], next_page: null }))
    vi.stubGlobal('fetch', fetchMock)
    const beforeRequest = vi.fn(async () => {
      expect(fetchMock).toHaveBeenCalledTimes(
        beforeRequest.mock.calls.length - 1
      )
    })
    await expect(listRemoteProjects(config, beforeRequest)).resolves.toEqual([
      ...first,
      { id: 'last' },
    ])
    expect(beforeRequest).toHaveBeenCalledTimes(2)
    const url = new URL(fetchMock.mock.calls[1][0] as string)
    expect(url.searchParams.get('page_token')).toBe('a+/=?&')
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBe('include')
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer test-token'
      )
    }
  })

  test('accepts an empty final page and deduplicates projects seen on multiple pages', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ items: [{ id: 'one', title: 'old' }], next_page: 'two' })
      )
      .mockResolvedValueOnce(
        json({ items: [{ id: 'one', title: 'new' }], next_page: 'three' })
      )
      .mockResolvedValueOnce(json({ items: [], next_page: null }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listRemoteProjects(config)).resolves.toEqual([
      { id: 'one', title: 'new' },
    ])
  })

  test('uses a complete legacy response if the API rolls back mid-refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          json({ items: [{ id: 'stale' }], next_page: 'two' })
        )
        .mockResolvedValueOnce(json([{ id: 'current' }]))
    )
    await expect(listRemoteProjects(config)).resolves.toEqual([
      { id: 'current' },
    ])
  })

  test('rejects the entire inventory when a later page fails, preserving retry metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          json({ items: [{ id: 'one' }], next_page: 'two' })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: 'Slow down' }), {
            status: 429,
            headers: { 'retry-after': '7' },
          })
        )
    )
    await expect(listRemoteProjects(config)).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7000,
    })
  })

  test.each([
    null,
    {},
    { items: [], next_page: 1 },
    { items: [] },
    { items: [], next_page: '' },
    { items: [null], next_page: null },
    [{ title: 'missing id' }],
  ])(
    'rejects malformed inventory instead of treating it as empty: %j',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValueOnce(json(body))
      )
      await expect(listRemoteProjects(config)).rejects.toThrow(
        'Invalid remote project'
      )
    }
  )

  test('rejects repeated cursors instead of looping or returning a partial inventory', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        json({ items: [{ id: 'one' }], next_page: 'repeat' })
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(listRemoteProjects(config)).rejects.toThrow(
      'pagination cursor'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
