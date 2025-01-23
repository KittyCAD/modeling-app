import { authCommands } from 'lib/commandBarConfigs/authCommandConfig'
import { PATHS } from 'lib/paths'
import { useAuthState } from 'machines/appMachine'
import { commandBarActor, useCommandBarState } from 'machines/commandBarMachine'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * A simple HOC that listens to the auth state of the app and navigates
 * accordingly.
 */
export function AuthNavigationHandler({
  children,
}: {
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const authState = useAuthState()

  // Subscribe to the auth state of the app and navigate accordingly.
  useEffect(() => {
    if (
      authState.matches('loggedIn') &&
      location.pathname.includes(PATHS.SIGN_IN)
    ) {
      navigate(PATHS.INDEX)
    } else if (
      authState.matches('loggedOut') &&
      !location.pathname.includes(PATHS.SIGN_IN)
    ) {
      navigate(PATHS.SIGN_IN)
    }
  }, [authState])

  return <>{children}</>
}
