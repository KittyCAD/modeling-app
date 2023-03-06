export default function withBaseUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.kittycad.io'
  return baseUrl + path
}
