import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import { appLaunchService } from '@src/registry/contracts/appLaunch'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { appUrlService } from '@src/registry/contracts/appUrl'
import { startSignInIntent } from '@src/registry/contracts/auth'
import { showHomeIntent } from '@src/registry/contracts/homeProjects'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * A simple hook that listens to the auth state of the app and navigates
 * accordingly.
 */
export function useAuthNavigation() {
  useSignals()
  const app = useApp()
  const { auth } = app
  const location = useLocation()
  const authState = auth.useAuthState()
  const launchPending = app.registry.get(appLaunchService).pending.value

  // Subscribe to the auth state of the app and navigate accordingly.
  useEffect(() => {
    if (
      authState.matches('loggedIn') &&
      location.pathname.includes(PATHS.SIGN_IN)
    ) {
      if (!launchPending) {
        // Launch completion can render before React commits the new location.
        // The URL service's cached location also waits for that React commit.
        const currentUrl = app.registry.get(appUrlService).readInitialUrl()
        if (
          currentUrl.type === 'launch' &&
          currentUrl.destination.type === 'sign-in'
        ) {
          void app.registry
            .get(appNavigationService)
            .dispatch(showHomeIntent, {})
        }
      }
    } else if (authState.matches('loggedOut')) {
      void app.registry
        .get(appNavigationService)
        .dispatch(startSignInIntent, { reason: 'logged-out' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [authState, location.pathname, launchPending])
}
