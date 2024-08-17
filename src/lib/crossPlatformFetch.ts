import { DEV } from 'env'
import { isDesktop } from 'lib/isDesktop'
import isomorphicFetch from 'isomorphic-fetch'

// TODO I not sure this file should exist

const headers = (token?: string): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
})

export default async function crossPlatformFetch<T>(
  url: string,
  options?: RequestInit,
  token?: string
): Promise<T | Error> {
  let response = null
  let opts = options || {}
  if (isDesktop()) {
    if (!token) {
      return new Error('No token provided')
    }

    opts.headers = headers(token)

    response = await isomorphicFetch(url, opts)
  } else {
    // Add credentials: 'include' to options
    // We send the token with the headers only in development mode, DO NOT
    // DO THIS IN PRODUCTION, as it is a security risk.
    opts.headers = headers(DEV ? token : undefined)
    opts.credentials = 'include'
    response = await fetch(url, opts)
  }

  if (!response) {
    return new Error('Failed to request endpoint: ' + url)
  }

  if (!response.ok) {
    console.error(
      'Failed to request endpoint: ' + url,
      JSON.stringify(response)
    )
    return new Error(
      'Failed to request endpoint: ' +
        url +
        ' with status: ' +
        response.status +
        ' ' +
        response.statusText
    )
  }

  const data = (await response.json()) as T | Error

  return data
}
