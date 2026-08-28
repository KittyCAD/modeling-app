import { Client, users } from '@kittycad/lib'
import type { AuthUser } from '@src/contracts/auth'

function apiBaseUrl(): string | undefined {
  return import.meta.env?.VITE_KC_API_BASE_URL as string | undefined
}

/**
 * Verify a token by asking the API who it belongs to.
 *
 * The only way to know a token is good is to use it, and the answer is also the
 * identity the menu needs, so verification and profile fetch are one request.
 *
 * Rejects with a message safe to show a user. The token never appears in it.
 */
export async function fetchUser(token: string): Promise<AuthUser> {
  const client = new Client({
    token,
    baseUrl: apiBaseUrl(),
    // Cookies matter on the web, where a session may authenticate the request
    // instead of the bearer token.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, credentials: 'include' })) as typeof fetch,
  })

  const response = await users.get_user_self({ client })

  const name =
    [response.first_name, response.last_name]
      .filter((part) => Boolean(part?.trim()))
      .join(' ')
      .trim() ||
    response.name?.trim() ||
    response.email ||
    'Signed in'

  return {
    id: response.id ?? 'unknown',
    name,
    email: response.email ?? '',
    imageUrl: response.image?.trim() ? response.image : undefined,
  }
}
