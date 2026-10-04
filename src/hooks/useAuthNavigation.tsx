import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { startSignInIntent } from '@src/registry/contracts/auth'
import { showHomeIntent } from '@src/registry/contracts/homeProjects'
import { openProjectIntent } from '@src/registry/contracts/projectSession'
import { appUrlService } from '@src/registry/contracts/appUrl'
import { reportRejection } from '@src/lib/trap'
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
      const returnTo = new URLSearchParams(location.search).get('returnTo')
      const intent = returnTo?.startsWith(`${PATHS.PROJECTS}/`)
        ? app.registry.get(appUrlService).readInitialUrl({
            requestUrl: new URL(returnTo, 'https://application.local').href,
            usesHashRouter: false,
          })
        : undefined
      if (
        intent?.type === 'launch' &&
        intent.destination.type === 'cloud-project'
      ) {
        void app.registry
          .get(appUrlService)
          .navigate(returnTo!, { replace: true })
        void app.registry
          .get(appNavigationService)
          .dispatch(openProjectIntent, {
            cloudProjectId: intent.destination.projectId,
            target: intent.destination.file ?? '',
            startup: { search: intent.search, hash: intent.hash },
          })
          .catch(reportRejection)
      } else {
        void app.registry.get(appNavigationService).dispatch(showHomeIntent, {})
      }
    } else if (authState.matches('loggedOut')) {
      void app.registry
        .get(appNavigationService)
        .dispatch(startSignInIntent, { reason: 'logged-out' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [authState, location.pathname])
}
