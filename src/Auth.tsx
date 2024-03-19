import Loading from './components/Loading'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const { auth } = useSettingsAuthContext()
  const isLoggingIn = auth?.state.matches('checkIfLoggedIn')

  return isLoggingIn ? (
    <Loading>
      <span data-testid="initial-load">Loading Modeling App...</span>
    </Loading>
  ) : (
    <>{children}</>
  )
}
