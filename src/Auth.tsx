import useSWR from 'swr'
import fetcher from './lib/fetcher'
import withBaseUrl from './lib/withBaseURL'
import { User, useStore } from './useStore'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { isTauri } from './lib/isTauri'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const { data: user, isLoading } = useSWR<
    User | Partial<{ error_code: string }>
  >(withBaseUrl('/user'), fetcher)
  const { token, setUser } = useStore((s) => ({
    token: s.token,
    setUser: s.setUser,
  }))
  const navigate = useNavigate()

  useEffect(() => {
    if (user && 'id' in user) setUser(user)
  }, [user, setUser])

  if (
    (isTauri() && !token) ||
    (!isTauri() && !isLoading && !(user && 'id' in user))
  ) {
    navigate('/signin')
  }

  return isLoading ? <>Loading...</> : <>{children}</>
}
