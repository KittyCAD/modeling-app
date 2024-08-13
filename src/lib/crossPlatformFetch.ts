import { isTauri } from './isTauri'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

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
  if (isTauri()) {
    if (!token) {
      return new Error('No token provided')
    }

    options = {
      headers: headers(token),
      ...options,
    }
    response = await tauriFetch(url, options)
  } else {
    // Add credentials: 'include' to options
    options = {
      credentials: 'include',
      headers: headers(),
      ...options,
    }
    response = await fetch(url, options)
  }

  if (!response) {
    return new Error('Failed to request endpoint: ' + url)
  }

  if (!response.ok) {
    return new Error(
      'Failed to request endpoint: ' + url + ' with status: ' + response.status
    )
  }

  const data = (await response.json()) as T | Error

  return data
}
