import { useAuthState } from 'machines/appMachine'

import Loading from './components/Loading'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const authState = useAuthState()
  const isLoggingIn = authState.matches('checkIfLoggedIn')

  return isLoggingIn ? (
    <Loading>
      <span data-testid="initial-load">Loading Modeling App...</span>
    </Loading>
  ) : (
    <>{children}</>
  )
}
