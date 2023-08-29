export default function fetcher(input: RequestInfo, init: RequestInit = {}) {
  const fetcherWithToken = async (token?: string): Promise<JSON> => {
    const headers = { ...init.headers } as Record<string, string>
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const credentials = 'include' as RequestCredentials
    const res = await fetch(input, { ...init, credentials, headers })
    return res.json()
  }
  return fetcherWithToken
}
