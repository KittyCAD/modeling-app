import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { startSignInIntent } from '@src/registry/contracts/auth'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * A simple hook that listens to the auth state of the app and navigates
 * accordingly.
 */
export function useAuthNavigation() {
  const app = useApp()
  const { auth } = app
  const location = useLocation()
  const authState = auth.useAuthState()

  // Subscribe to the auth state of the app and navigate accordingly.
  useEffect(() => {
    if (
      authState.matches('loggedIn') &&
      location.pathname.includes(PATHS.SIGN_IN)
    ) {
      void app.registry.get(appNavigationService).showHome()
    } else if (authState.matches('loggedOut')) {
      void app.registry
        .get(appNavigationService)
        .dispatch(startSignInIntent, { reason: 'logged-out' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [authState, location.pathname])
}
