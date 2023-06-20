export default function withBaseUrl(path: string): string {
  const baseUrl = 'https://api.dev.kittycad.io'
  return baseUrl + path
}
