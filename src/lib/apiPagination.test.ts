import { ApiError, Client } from '@kittycad/lib'
import type { Announcement, ProjectShareLinkResponse } from '@kittycad/lib'
import { listClientItems } from '@src/lib/apiPagination'
import { describe, expect, test, vi } from 'vitest'

const announcement: Announcement = {
  id: 'announcement-1',
  title: 'New release',
  active: true,
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-25T00:00:00Z',
}

describe('API list compatibility', () => {
  test.each([
    {
      path: '/announcements',
      body: { announcements: [announcement] },
    },
    {
      path: '/announcements?locale=en',
      body: { announcements: [announcement] },
    },
    {
      path: '/announcements',
      body: { items: [announcement], next_page: null },
    },
    {
      path: '/announcements?locale=en',
      body: { items: [announcement], next_page: null },
    },
  ])(
    'accepts legacy and paginated announcements at $path',
    async ({ path, body }) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(body))
      const client = new Client({
        baseUrl: 'https://api.example.test/proxy/',
        token: 'test-token',
        fetch: transport,
      })
      const controller = new AbortController()

      await expect(
        listClientItems<Announcement>(client, path, controller.signal)
      ).resolves.toEqual([announcement])
      expect(transport).toHaveBeenCalledWith(
        `https://api.example.test/proxy${path}`,
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
          signal: controller.signal,
        }
      )
    }
  )

  test.each([
    { name: 'empty initial', firstPage: null, items: [] },
    { name: 'nonempty initial', firstPage: null, items: [announcement] },
    {
      name: 'empty later',
      firstPage: { items: [announcement], next_page: 'next' },
      items: [],
    },
    {
      name: 'nonempty later',
      firstPage: { items: [], next_page: 'next' },
      items: [announcement],
    },
  ])(
    'accepts an omitted cursor on an $name terminal page',
    async ({ firstPage, items }) => {
      const transport = vi.fn<typeof fetch>()
      if (firstPage) {
        transport.mockResolvedValueOnce(Response.json(firstPage))
      }
      transport.mockResolvedValueOnce(Response.json({ items }))
      const client = new Client({
        baseUrl: 'https://api.example.test',
        fetch: transport,
      })

      await expect(
        listClientItems<Announcement>(client, '/announcements')
      ).resolves.toEqual([...(firstPage?.items ?? []), ...items])
      expect(transport).toHaveBeenCalledTimes(firstPage ? 2 : 1)
      if (firstPage) {
        expect(transport.mock.calls[1][0]).toBe(
          'https://api.example.test/announcements?page_token=next'
        )
      }
    }
  )

  test('rejects the announcements envelope at a different endpoint with the same prefix', async () => {
    const client = new Client({
      baseUrl: 'https://api.example.test',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ announcements: [announcement] })),
    })

    await expect(
      listClientItems<Announcement>(client, '/announcements-archive?locale=en')
    ).rejects.toThrow('Invalid API list response')
  })

  test.each([
    { items: [], next_page: 'same' },
    { items: [], next_page: '' },
    { items: [], next_page: 5 },
    { next_page: null },
    {},
    [],
  ])(
    'rejects malformed or changed continuation instead of returning an empty share list',
    async (secondPage) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ items: [], next_page: 'same' }))
        .mockResolvedValueOnce(Response.json(secondPage))
      const client = new Client({
        baseUrl: 'https://api.example.test',
        fetch: transport,
      })

      await expect(
        listClientItems<ProjectShareLinkResponse>(
          client,
          '/user/projects/project-1/share-links'
        )
      ).rejects.toBeInstanceOf(Error)
      expect(transport).toHaveBeenCalledTimes(2)
    }
  )

  test('preserves HTTP status for cleanup handling without converting failure to an empty list', async () => {
    const client = new Client({
      baseUrl: 'https://api.example.test',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ message: 'Not found' }, { status: 404 })
        ),
    })
    await expect(
      listClientItems<ProjectShareLinkResponse>(
        client,
        '/user/projects/missing/share-links'
      )
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Not found',
    })
    await expect(
      listClientItems(client, '/user/projects/missing/share-links')
    ).rejects.toBeInstanceOf(ApiError)
  })
})
