export default async function fetcher<JSON = any>(
  input: RequestInfo,
  init: RequestInit = {}
): Promise<JSON> {
  const credentials = 'include' as RequestCredentials
  const res = await fetch(input, { ...init, credentials })
  return res.json()
}
