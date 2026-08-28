import { Client, users } from '@kittycad/lib'
import type { FeatureId } from '@src/contracts/userFeatures'

function apiBaseUrl(): string | undefined {
  return import.meta.env?.VITE_KC_API_BASE_URL as string | undefined
}

/**
 * Ask the API which features this account has.
 *
 * The endpoint returns only what is both safe to expose and resolved true for
 * the caller — org overrides included — so the answer is a set of ids and
 * nothing has to interpret a value.
 *
 * Rejects with a message safe to show a user. The token never appears in it.
 */
export async function fetchUserFeatures(
  token: string
): Promise<ReadonlySet<FeatureId>> {
  const client = new Client({
    token,
    baseUrl: apiBaseUrl(),
    // Cookies matter on the web, where a session may authenticate the request
    // instead of the bearer token. Same shape as the identity fetch.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, credentials: 'include' })) as typeof fetch,
  })

  const response = await users.user_features_get({ client })

  return new Set((response.features ?? []).map((entry) => entry.id))
}
