import {
  getRemoteProjectThumbnailUrl,
  normalizeRemoteProjectThumbnailUrl,
  remoteProjectThumbnailTargetPathFromUrl,
  thumbnailUrlFromRemoteProjectPayload,
} from '@src/lib/cloudSync/cloudApi'
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
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
})
