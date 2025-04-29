import { VITE_KC_API_BASE_URL } from '@src/env'

export default function withBaseUrl(path: string): string {
  return VITE_KC_API_BASE_URL + path
}
