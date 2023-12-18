import Loading from './components/Loading'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const { auth } = useGlobalStateContext()
  const isLoggingIn = auth?.state.matches('checkIfLoggedIn')

  return isLoggingIn ? (
    <Loading>
      <span data-testid="initial-load">Loading Modeling App...</span>
    </Loading>
  ) : (
    <>{children}</>
  )
}
