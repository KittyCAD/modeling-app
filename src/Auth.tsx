import Loading from '@src/components/Loading'
import { useAuthState } from '@src/lib/singletons'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const authState = useAuthState()
  const isLoggingIn = authState.matches('checkIfLoggedIn')

  return isLoggingIn ? (
    <Loading className="h-screen w-screen">
      <span data-testid="initial-load">Loading Design Studio...</span>
    </Loading>
  ) : (
    <>{children}</>
  )
}
