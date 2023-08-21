import { useAuthMachine } from '../hooks/useAuthMachine'

export default async function fetcher<JSON = any>(
  input: RequestInfo,
  init: RequestInit = {}
): Promise<JSON> {
  const [token] = useAuthMachine((s) => s?.context?.token)
  const headers = { ...init.headers } as Record<string, string>
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const credentials = 'include' as RequestCredentials
  const res = await fetch(input, { ...init, credentials, headers })
  return res.json()
}
