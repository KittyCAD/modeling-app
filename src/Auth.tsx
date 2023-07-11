import useSWR from 'swr'
import fetcher from './lib/fetcher'
import withBaseUrl from './lib/withBaseURL'
import { App } from './App'
import { SetToken } from './components/TokenInput'
import { useStore } from './useStore'

export const Auth = () => {
  const { data: user } = useSWR(withBaseUrl('/user'), fetcher) as any
  const  {token} = useStore((s) => ({
    token: s.token
  }))

  const isLocalHost =
    typeof window !== 'undefined' && window.location.hostname === 'localhost'

  if ((window as any).__TAURI__ && !token) {
    return <SetToken />
  }

  if (!user && !isLocalHost) {
    return (
      <>
        <div className=" bg-gray-800 p-1 px-4 rounded-r-lg pointer-events-auto flex items-center">
          <a
            className="font-bold mr-2 text-purple-400"
            rel="noopener noreferrer"
            target={'_self'}
            href={`https://dev.kittycad.io/signin?callbackUrl=${encodeURIComponent(
              typeof window !== 'undefined' && window.location.href
            )}`}
          >
            Sign in
          </a>
        </div>
      </>
    )
  }

  return <App />
}
