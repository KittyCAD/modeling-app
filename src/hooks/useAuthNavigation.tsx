import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { startSignInIntent } from '@src/registry/contracts/auth'

/**
 * A simple hook that listens to the auth state of the app and navigates
 * accordingly.
 */
export function useAuthNavigation() {
  const app = useApp()
  const { auth } = app
  const navigate = useNavigate()
  const location = useLocation()
  const authState = auth.useAuthState()

  // Subscribe to the auth state of the app and navigate accordingly.
  useEffect(() => {
    if (
      authState.matches('loggedIn') &&
      location.pathname.includes(PATHS.SIGN_IN)
    ) {
      void navigate(PATHS.INDEX)
    } else if (authState.matches('loggedOut')) {
      void app.registry
        .get(appNavigationService)
        .dispatch(startSignInIntent, { reason: 'logged-out' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [authState, location.pathname])
}
