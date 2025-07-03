import {
  VITE_KC_API_BASE_URL,
  VITE_KC_SITE_BASE_URL,
  VITE_KC_API_WS_MODELING_URL,
} from '@src/env'

export function withAPIBaseURL(path: string): string {
  return VITE_KC_API_BASE_URL + path
}

export function withSiteBaseURL(path: string): string {
  return VITE_KC_SITE_BASE_URL + path
}

export function withWebSocketURL(path: string): string {
  return VITE_KC_API_WS_MODELING_URL + path
}
