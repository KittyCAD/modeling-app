import { Client } from '@kittycad/lib'
import type { ApiError } from '@kittycad/lib'
import env from '@src/env'
import { isDesktop } from '@src/lib/isDesktop'
import isomorphicFetch from 'isomorphic-fetch'

export function createKCClient(
  token?: string,
  baseUrlOverride?: string
): Client {
  const baseUrl = baseUrlOverride || env().VITE_KITTYCAD_API_BASE_URL
  const injectedFetch = ((input: any, init?: any) => {
    const impl =
      typeof fetch !== 'undefined'
        ? fetch
        : (isomorphicFetch as unknown as typeof fetch)
    const opts: RequestInit = { ...(init || {}) }
    if (!isDesktop()) {
      opts.credentials = 'include'
    }
    return impl(input, opts as any)
  }) as typeof fetch
  return new Client({ token, baseUrl, fetch: injectedFetch })
}

export async function kcCall<T>(fn: () => Promise<T>): Promise<T | Error> {
  try {
    return await fn()
  } catch (e: unknown) {
    const ae = e as Partial<ApiError> & { message?: string }
    const msg =
      (ae && (ae as any).body && (ae as any).body.message) ||
      ae?.message ||
      'An unexpected error occurred.'
    return new Error(msg)
  }
}
