import env from '@src/env'

export function withAPIBaseURL(path: string): string {
  return env().VITE_ZOO_API_BASE_URL + path
}

export function withSiteBaseURL(path: string): string {
  return env().VITE_ZOO_SITE_BASE_URL + path
}

export function withWebSocketURL(path: string): string {
  return env().VITE_KITTYCAD_WEBSOCKET_URL + path
}
