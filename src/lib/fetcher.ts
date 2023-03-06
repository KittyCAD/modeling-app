export default async function fetcher<JSON = any>(
  input: RequestInfo,
  init: RequestInit = {}
): Promise<JSON> {
  const credentials = 'include'
  const res = await fetch(input, { ...init, credentials })
  return res.json()
}
