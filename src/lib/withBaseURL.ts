import env from '@src/env'

export function withAPIBaseURL(path: string): string {
  return env().VITE_ZOO_API_BASE_URL + path
}

export function withSiteBaseURL(path: string): string {
  return env().VITE_ZOO_SITE_BASE_URL + path
}

export function withKittycadWebSocketURL(querystring: string): string {
  const url = env().VITE_KITTYCAD_WEBSOCKET_URL
  if (!url) {
    return ''
  }
  // Append to existing query string if it exists
  if (url.includes('?') && querystring.startsWith('?')) {
    return url + querystring.replace(/^\?/, '&')
  }
  return url + querystring
}

export function withMlephantWebSocketURL(querystring: string): string {
  const url = env().VITE_MLEPHANT_WEBSOCKET_URL
  if (!url) {
    return ''
  }
  // Append to existing query string if it exists
  if (url.includes('?') && querystring.startsWith('?')) {
    return url + querystring.replace(/^\?/, '&')
  }
  return url + querystring
}
