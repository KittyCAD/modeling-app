import env from '@src/env'

export function withAPIBaseURL(path: string): string {
  return env().VITE_ZOO_API_BASE_URL + path
}

export function withSiteBaseURL(path: string): string {
  return env().VITE_ZOO_SITE_BASE_URL + path
}

export function withKittycadWebSocketURL(qs: string): string {
  return mergeQueryString(env().VITE_KITTYCAD_WEBSOCKET_URL, qs)
}

export function withMlephantWebSocketURL(qs: string): string {
  return mergeQueryString(env().VITE_MLEPHANT_WEBSOCKET_URL, qs)
}

function mergeQueryString(url: string | undefined, qs: string): string {
  if (!url) {
    return ''
  }
  // Append to existing query string if it exists
  if (url.includes('?') && qs.startsWith('?')) {
    return url + qs.replace(/^\?/, '&')
  }
  return url + qs
}
