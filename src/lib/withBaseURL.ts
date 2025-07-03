import env from '@src/env'

export function withAPIBaseURL(path: string): string {
  return env().VITE_KC_API_BASE_URL + path
}

export function withSiteBaseURL(path: string): string {
  return env().VITE_KC_SITE_BASE_URL + path
}
