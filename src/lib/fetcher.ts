// import { FetchOptions, fetch as tauriFetch } from '@tauri-apps/api/http'
// import { useStore } from '../useStore'
// import { isTauri } from './isTauri'

export default async function fetcher<JSON = any>(
  input: RequestInfo,
  init: RequestInit = {}
): Promise<JSON> {
  // if (isTauri()) {
  //   const token = useStore.getState().token
  //   const res = await tauriFetch(input as string, {
  //     ...init,
  //     headers: {
  //       ...init.headers,
  //       Authorization: `Bearer ${token}`,
  //     },
  //   } as FetchOptions)
  //   console.log('hello??', {res})
  //   return res.data as JSON
  // }

  const credentials = 'include' as RequestCredentials
  const res = await fetch(input, { ...init, credentials })
  return res.json()
}
