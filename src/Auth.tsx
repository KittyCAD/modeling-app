import Loading from '@src/components/Loading'
import { useApp } from '@src/lib/boot'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const { auth } = useApp()
  const authState = auth.useAuthState()
  const isLoggingIn = authState.matches('checkIfLoggedIn')

  return isLoggingIn ? (
    <Loading className="h-screen w-screen">
      <span data-testid="initial-load">Loading Design Studio...</span>
    </Loading>
  ) : (
    <>{children}</>
  )
}
