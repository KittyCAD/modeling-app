import { VITE_KITTYCAD_API_BASE_URL } from '@src/env'

export function withAPIBaseURL(path: string): string {
  return VITE_KITTYCAD_API_BASE_URL + path
}
