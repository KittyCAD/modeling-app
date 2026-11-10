import { Client, meta, projects } from '@kittycad/lib'
import type { Announcement, ApiError } from '@kittycad/lib'
import { collectApiPages } from '@src/lib/apiPagination'
import { describe, expect, test, vi } from 'vitest'

const announcement: Announcement = {
  id: 'announcement-1',
  title: 'New release',
  active: true,
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-25T00:00:00Z',
}

const pagers = [
  { path: '/announcements', create: meta.get_announcements_pager },
  { path: '/user/projects', create: projects.list_projects_pager },
  {
    path: '/projects/categories',
    create: projects.list_project_categories_pager,
  },
]

describe('complete SDK page collection', () => {
  test.each(pagers)(
    'loads every page of $path, including empty pages',
    async ({ path, create }) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ items: [], next_page: 'next+/=' })
        )
        .mockResolvedValueOnce(
          Response.json({ items: [announcement], next_page: null })
        )
      const client = new Client({
        baseUrl: 'https://api.example.test',
        token: 'test-token',
        fetch: transport,
      })
      await expect(
        collectApiPages<unknown>(create({ client }))
      ).resolves.toEqual([announcement])
      expect(transport).toHaveBeenCalledTimes(2)
      expect(transport).toHaveBeenLastCalledWith(
        `https://api.example.test${path}?page_token=next%2B%2F%3D`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
    }
  )

  test.each([null, undefined])(
    'accepts a terminal SDK page with cursor %s',
    async (next_page) => {
      const client = new Client({
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            Response.json({ items: [announcement], next_page })
          ),
      })
      await expect(
        collectApiPages(meta.get_announcements_pager({ client }))
      ).resolves.toEqual([announcement])
    }
  )

  test.each([
    { announcements: [announcement] },
    [announcement],
    { items: null, next_page: null },
    { next_page: null },
  ])(
    'rejects obsolete or malformed responses instead of silently returning an empty list',
    async (body) => {
      const client = new Client({
        fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(body)),
      })
      await expect(
        collectApiPages(meta.get_announcements_pager({ client }))
      ).rejects.toBeInstanceOf(Error)
    }
  )

  test.each([
    { items: [], next_page: 'same' },
    { items: [], next_page: '' },
    { items: [], next_page: '   ' },
    { items: [], next_page: 5 },
    {},
    [],
  ])(
    'rejects invalid continuation without returning a partial list',
    async (secondPage) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ items: [announcement], next_page: 'same' })
        )
        .mockResolvedValueOnce(Response.json(secondPage))
      const client = new Client({ fetch: transport })
      await expect(
        collectApiPages(meta.get_announcements_pager({ client }))
      ).rejects.toBeInstanceOf(Error)
      expect(transport).toHaveBeenCalledTimes(2)
    }
  )

  test('preserves a later HTTP error instead of returning the first page', async () => {
    const client = new Client({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ items: [announcement], next_page: 'next' })
        )
        .mockResolvedValueOnce(
          Response.json({ message: 'Unavailable' }, { status: 503 })
        ),
    })
    await expect(
      collectApiPages(meta.get_announcements_pager({ client }))
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'Unavailable',
    } satisfies Partial<ApiError>)
  })
})
