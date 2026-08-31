import { describe, expect, it, vi } from 'vitest'
import { createAnnouncementsApi } from '@src/features/home/announcementsApi'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const api = (fetchImpl: typeof fetch, baseUrl = 'https://api.test') =>
  createAnnouncementsApi({ baseUrl, fetch: fetchImpl })

describe('the announcements API', () => {
  it('returns the active announcements', async () => {
    const request = vi.fn(async () =>
      ok({
        announcements: [
          { id: 'a1', title: 'New sketch mode', body: 'It is better.' },
        ],
      })
    )

    const list = await api(request as unknown as typeof fetch).list()

    expect(list).toEqual([
      { id: 'a1', title: 'New sketch mode', body: 'It is better.' },
    ])
  })

  it('drops the ones the server marked inactive', async () => {
    const request = vi.fn(async () =>
      ok({
        announcements: [
          { id: 'a1', title: 'Live', active: true },
          { id: 'a2', title: 'Retired', active: false },
        ],
      })
    )

    const list = await api(request as unknown as typeof fetch).list()

    expect(list.map((each) => each.id)).toEqual(['a1'])
  })

  /* A banner with no title is a box with nothing in it. */
  it('drops entries missing an id or a title', async () => {
    const request = vi.fn(async () =>
      ok({
        announcements: [
          { id: 'a1' },
          { title: 'No id' },
          { id: 'a2', title: 'Fine' },
        ],
      })
    )

    const list = await api(request as unknown as typeof fetch).list()

    expect(list.map((each) => each.id)).toEqual(['a2'])
  })

  it('sends no Authorization header: the endpoint needs none', async () => {
    let seen: string | null = null
    const request = async (_url: string, init?: RequestInit) => {
      seen = new Headers(init?.headers).get('Authorization')
      return ok({ announcements: [] })
    }

    await api(request as unknown as typeof fetch).list()

    expect(seen).toBeNull()
  })

  it('is silent rather than failing when the request does', async () => {
    const request = vi.fn(async () => new Response('nope', { status: 500 }))

    await expect(
      api(request as unknown as typeof fetch).list()
    ).resolves.toEqual([])
  })

  it('asks for nothing when there is no API base URL', async () => {
    const request = vi.fn(async () => ok({ announcements: [] }))

    const list = await api(request as unknown as typeof fetch, '').list()

    expect(list).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })
})
