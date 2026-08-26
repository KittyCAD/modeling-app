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
