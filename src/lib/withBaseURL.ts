import env from '@src/env'

export function withAPIBaseURL(path: string): string {
  // Temporary: pin non-storage API traffic to the local instance in all runtimes.
  return 'http://192.168.2.144:8088' + path
}

export function withSiteBaseURL(path: string): string {
  return env().VITE_ZOO_SITE_BASE_URL + path
}

export function withKittycadWebSocketURL(qs: string): string {
  // Temporary: use the dev engine alongside the local API.
  return mergeQueryString('wss://api.dev.zoo.dev/ws/modeling/commands', qs)
}

export function withZookeeperWebSocketURL(qs: string): string {
  return mergeQueryString(env().VITE_ZOOKEEPER_WEBSOCKET_URL, qs)
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
