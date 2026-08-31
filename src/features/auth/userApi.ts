import { Client, orgs, users } from '@kittycad/lib'
import type { AuthOrg, AuthUser } from '@src/contracts/auth'

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

  /*
   * The org, in the same pass, and never fatal: a rejected sign-in over "you are
   * not in an org" would be absurd, and org membership is not what the token is
   * being verified for.
   */
  const lookup = await fetchOrg(client)

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
    org: lookup.org,
    orgError: lookup.error,
  }
}

/** The status a thrown `@kittycad/lib` error carries, when it carries one. */
function statusOf(cause: unknown): number | null {
  if (typeof cause !== 'object' || cause === null) return null
  const status = (cause as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function messageOf(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null) {
    const body = (cause as { error?: { message?: unknown } }).error
    if (typeof body?.message === 'string' && body.message) return body.message
  }
  return cause instanceof Error ? cause.message : 'the request failed'
}

/**
 * Ask which org this account belongs to.
 *
 * Three outcomes, not two, and keeping them apart is the whole point of the
 * shape. A 404 is the endpoint's way of saying "not a member" and is an answer.
 * Anything else — a 401, a 403, a network failure — leaves the question open,
 * and reporting that as "not a member" is a claim this function cannot support.
 *
 * The generated client throws on any non-2xx with the status attached, so the
 * status is what separates the two.
 */
async function fetchOrg(
  client: Client
): Promise<{ org: AuthOrg | null; error: string | null }> {
  try {
    const org = await orgs.get_user_org({ client })
    if (!org?.id) {
      // A 2xx with no id is not something the schema allows, so it is a
      // surprise rather than an absence.
      return { org: null, error: 'the org endpoint returned no id' }
    }
    return {
      org: {
        id: org.id,
        name: org.name?.trim() || org.domain?.trim() || 'Your org',
        role: org.role ?? '',
      },
      error: null,
    }
  } catch (cause) {
    const status = statusOf(cause)
    if (status === 404) return { org: null, error: null }
    return {
      org: null,
      error:
        status === null
          ? messageOf(cause)
          : `HTTP ${status}: ${messageOf(cause)}`,
    }
  }
}
