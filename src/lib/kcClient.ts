import { Client } from '@kittycad/lib'
import type { ApiError } from '@kittycad/lib'
import { isDesktop } from '@src/lib/isDesktop'
import { notifySessionExpiredFromResponse } from '@src/lib/sessionExpired'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import isomorphicFetch from 'isomorphic-fetch'

export function createKCClient(
  token?: string,
  baseUrlOverride?: string
): Client {
  const baseUrl = baseUrlOverride || withAPIBaseURL('')
  const injectedFetch = (async (input: any, init?: any) => {
    const opts: RequestInit = { ...(init || {}) }
    const impl = typeof fetch !== 'undefined' ? fetch : isomorphicFetch
    if (!isDesktop()) {
      opts.credentials = 'include'
    }
    const response = await impl(input, opts)
    notifySessionExpiredFromResponse(response)
    return response
  }) as typeof fetch
  return new Client({ token, baseUrl, fetch: injectedFetch })
}

export async function kcCall<T>(fn: () => Promise<T>): Promise<T | Error> {
  try {
    return await fn()
  } catch (e: unknown) {
    // We do not need to type this with {message?: string}
    // The type system is already thrown out the window and we do a key check before dereferencing.
    const ae = e as Partial<ApiError>
    const msg =
      (ae && (ae as any).body && (ae as any).body.message) ||
      ae?.message ||
      'An unexpected error occurred.'
    return new Error(msg)
  }
}
