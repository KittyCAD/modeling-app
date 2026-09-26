import { ApiError } from '@kittycad/lib'
import type { Client } from '@kittycad/lib'

export type ApiListResponse<T> = T[] | { items: T[]; next_page: string | null }

/** Keep legacy responses during rollout; never return an incomplete traversal. */
export async function collectApiList<T>(
  path: string,
  read: (path: string) => Promise<ApiListResponse<T>>
): Promise<T[]> {
  const items: T[] = []
  const seen = new Set<string>()
  let nextPath = path

  while (true) {
    const page = await read(nextPath)
    // This module is also imported by Node cleanup scripts, without app aliases.
    // eslint-disable-next-line no-restricted-syntax
    if (Array.isArray(page)) {
      if (seen.size !== 0) {
        return Promise.reject(
          new Error('API list changed format during pagination')
        )
      }
      return page
    }
    if (
      page === null ||
      typeof page !== 'object' ||
      // eslint-disable-next-line no-restricted-syntax
      !Array.isArray(page.items)
    ) {
      return Promise.reject(new Error('Invalid API list response'))
    }
    items.push(...page.items)
    if (page.next_page === null) return items
    if (
      typeof page.next_page !== 'string' ||
      !page.next_page ||
      seen.has(page.next_page)
    ) {
      return Promise.reject(
        new Error('Invalid or repeated API pagination cursor')
      )
    }
    seen.add(page.next_page)
    const url = new URL(path, 'https://api.zoo.dev')
    url.searchParams.set('page_token', page.next_page)
    nextPath = `${url.pathname}${url.search}`
  }
}

/** Use the SDK client's configured transport while its generated list types lag. */
export function listClientItems<T>(
  client: Client,
  path: string,
  signal?: AbortSignal
): Promise<T[]> {
  return collectApiList<T>(path, async (nextPath) => {
    const response = await (client.fetch ?? fetch)(
      `${(client.baseUrl ?? 'https://api.zoo.dev').replace(/\/+$/, '')}${nextPath}`,
      {
        method: 'GET',
        headers: client.token
          ? { Authorization: `Bearer ${client.token}` }
          : {},
        signal,
      }
    )
    if (!response.ok) {
      const body: { message?: string } = await response.json().catch(() => ({}))
      return Promise.reject(new ApiError(response.status, body))
    }
    const body: ApiListResponse<T> | { announcements: T[] } =
      await response.json()
    if (body !== null && typeof body === 'object' && 'announcements' in body) {
      if (path !== '/announcements') {
        return Promise.reject(new Error('Invalid API list response'))
      }
      return body.announcements
    }
    return body
  })
}
