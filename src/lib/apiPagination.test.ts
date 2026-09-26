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
    { announcements: [announcement] },
    { items: [announcement], next_page: null },
  ])('accepts legacy and paginated announcements', async (body) => {
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
      listClientItems<Announcement>(client, '/announcements', controller.signal)
    ).resolves.toEqual([announcement])
    expect(transport).toHaveBeenCalledWith(
      'https://api.example.test/proxy/announcements',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer test-token' },
        signal: controller.signal,
      }
    )
  })

  test.each([
    { items: [], next_page: 'same' },
    { items: [], next_page: '' },
    { items: [], next_page: 5 },
    { items: [] },
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
