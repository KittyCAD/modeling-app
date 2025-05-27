import { DEV } from '@src/env'
import isomorphicFetch from 'isomorphic-fetch'

import { isDesktop } from '@src/lib/isDesktop'
import { err } from './trap'

// TODO I not sure this file should exist

const headers = (token?: string): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
})

export default async function crossPlatformFetch<T>(
  url: string,
  options?: RequestInit,
  token?: string,
  rewriteError = true
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
    const jsonBody = await response.json().catch((e) => e)
    console.error(
      `Failed to request endpoint: ${url}`,
      JSON.stringify(response),
      jsonBody
    )
    const fallbackErrorMessage = `Failed to request endpoint: ${url} with status: ${response.status} ${response.statusText}`
    const resolvedMessage =
      !err(jsonBody) && 'message' in jsonBody
        ? jsonBody.message
        : fallbackErrorMessage
    return new Error(resolvedMessage)
  }

  const data = (await response.json()) as T | Error

  return data
}
