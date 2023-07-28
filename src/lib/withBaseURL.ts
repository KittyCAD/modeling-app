export default function withBaseUrl(path: string): string {
  const baseUrl = import.meta.env.VITE_KC_API_BASE_URL
  return baseUrl + path
}
