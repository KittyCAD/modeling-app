import { meta, projects } from '@kittycad/lib'
import { collectApiPages } from '@src/lib/apiPagination'
import { createKCClient } from '@src/lib/kcClient'
import {
  clearSessionExpiredNotice,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import { afterEach, describe, expect, it, test, vi } from 'vitest'

vi.mock('@src/lib/isDesktop', () => ({ isDesktop: () => false }))

afterEach(() => {
  vi.unstubAllGlobals()
  clearSessionExpiredNotice()
})

describe('app SDK pager transport', () => {
  test('preserves browser credentials, authentication and request options on every page', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [], next_page: 'more' }))
      .mockResolvedValueOnce(Response.json({ items: [], next_page: null }))
    vi.stubGlobal('fetch', transport)
    const controller = new AbortController()
    const client = createKCClient(
      'test-token',
      'https://api.example.test/proxy/',
      {
        signal: controller.signal,
        cache: 'no-cache',
      }
    )
    await expect(
      collectApiPages(meta.get_announcements_pager({ client }))
    ).resolves.toEqual([])
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/proxy/announcements',
      'https://api.example.test/proxy/announcements?page_token=more',
    ])
    for (const [, options] of transport.mock.calls) {
      expect(options).toMatchObject({
        method: 'GET',
        credentials: 'include',
        cache: 'no-cache',
        signal: controller.signal,
        headers: { Authorization: 'Bearer test-token' },
      })
    }
  })

  test('cancels continuation through the same request signal', async () => {
    const controller = new AbortController()
    const transport = vi.fn<typeof fetch>(async (_input, init) => {
      init?.signal?.throwIfAborted()
      controller.abort()
      return Response.json({ items: [], next_page: 'more' })
    })
    vi.stubGlobal('fetch', transport)
    const client = createKCClient(undefined, 'https://api.example.test', {
      signal: controller.signal,
    })
    await expect(
      collectApiPages(meta.get_announcements_pager({ client }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  test('reports session expiry on an unsuccessful continuation page', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ items: [], next_page: 'more' }))
        .mockResolvedValueOnce(
          Response.json({ message: 'Expired' }, { status: 401 })
        )
    )
    const client = createKCClient(undefined, 'https://api.example.test')
    await expect(
      collectApiPages(meta.get_announcements_pager({ client }))
    ).rejects.toMatchObject({ status: 401 })
    expect(sessionExpiredNotice.value?.source).toBe('fetch')
  })
})

it('sends project requests to the requested API with the supplied credentials', async () => {
  const requests: Array<{ url: string; authorization: string | null }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('Authorization'),
      })
      return Response.json({ id: 'project-123' })
    })
  )

  await projects.get_project({
    client: createKCClient('test-token', 'https://api.example.test'),
    id: 'project-123',
  })

  expect(requests).toEqual([
    {
      url: 'https://api.example.test/user/projects/project-123',
      authorization: 'Bearer test-token',
    },
  ])
})
