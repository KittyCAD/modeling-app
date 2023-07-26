import useSWR from 'swr'
import fetcher from './lib/fetcher'
import withBaseUrl from './lib/withBaseURL'
import { SetToken } from './components/TokenInput'
import { useStore } from './useStore'
import {
  useNavigate,
} from "react-router-dom"
import { useEffect } from 'react'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const { data: user } = useSWR(withBaseUrl('/user'), fetcher) as any
  const  {token, setUser} = useStore((s) => ({
    token: s.token,
    setUser: s.setUser,
  }))
  const navigate = useNavigate()

  useEffect(() => {
    if (user && !user.error_code) { setUser(user) }
  }, [user, setUser])

  const isLocalHost =
    typeof window !== 'undefined' && window.location.hostname === 'localhost'

  if ((window as any).__TAURI__ && !token) {
    return <SetToken />
  }

  if (!token && !isLocalHost) {
    navigate('/signin')
  }

  return <>{children}</>
}
