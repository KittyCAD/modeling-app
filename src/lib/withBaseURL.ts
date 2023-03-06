export default function withBaseUrl(path: string): string {
  const baseUrl = 'https://dev.api.kittycad.io'
  return baseUrl + path
}
