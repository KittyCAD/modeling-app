import { PATHS } from 'lib/paths'
import { useAuthState } from 'machines/appMachine'
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

  // TODO: Reactivate this once I fix up the command
  // type plumbing.
  // useStateMachineCommands({
  //     machineId: 'auth',
  //     state: authState,
  //     send: authActor.send,
  //     commandBarConfig: authCommandBarConfig,
  //     actor: authActor,
  //   })

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
