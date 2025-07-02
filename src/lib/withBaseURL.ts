import { VITE_KITTYCAD_API_URL } from '@src/env'

export default function withBaseUrl(path: string): string {
  return VITE_KITTYCAD_API_URL + path
}
