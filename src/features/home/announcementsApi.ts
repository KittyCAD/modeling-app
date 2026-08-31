/** One item of Zoo news, narrowed to what the column shows. */
export interface Announcement {
  id: string
  title: string
  body: string | null
}

interface AnnouncementResponse {
  id?: string
  title?: string
  body?: string | null
  active?: boolean
}

/**
 * Zoo's active announcements.
 *
 * Unauthenticated — the endpoint says so, and it matters: announcements are the
 * one thing on Home worth showing before somebody has signed in, which is
 * exactly when an app is most likely to be telling them something they need.
 *
 * Failure is silence, not an error state. A banner that could not be fetched is
 * not a problem the person reading Home can act on, and an error where news
 * would go reads as though something is broken.
 */
export function createAnnouncementsApi(options: {
  baseUrl?: string
  fetch?: typeof fetch
}) {
  const request = options.fetch ?? fetch
  const baseUrl = (
    options.baseUrl ??
    (import.meta.env?.VITE_KC_API_BASE_URL as string | undefined) ??
    ''
  ).replace(/\/+$/, '')

  return {
    async list(signal?: AbortSignal): Promise<readonly Announcement[]> {
      if (!baseUrl) return []

      const response = await request(`${baseUrl}/announcements`, { signal })
      if (!response.ok) return []

      const body = (await response.json()) as {
        announcements?: AnnouncementResponse[]
      }

      return (body.announcements ?? [])
        .filter((each) => each.active !== false)
        .flatMap((each) =>
          each.id && each.title
            ? [{ id: each.id, title: each.title, body: each.body ?? null }]
            : []
        )
    },
  }
}
