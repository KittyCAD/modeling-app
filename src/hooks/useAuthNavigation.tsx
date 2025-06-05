import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM } from '@src/lib/constants'
import { useAuthState } from '@src/lib/singletons'
import { generateSignInUrl } from '@src/routes/utils'

/**
 * A simple hook that listens to the auth state of the app and navigates
 * accordingly.
 */
export function useAuthNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const authState = useAuthState()
  const [searchParams] = useSearchParams()
  const requestingImmediateSignInIfNecessary = searchParams.has(
    IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM
  )

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
      if (requestingImmediateSignInIfNecessary && !isDesktop()) {
        window.location.href = generateSignInUrl()
        return
      }

      navigate(PATHS.SIGN_IN + (location.search || ''))
    }
  }, [authState, location.pathname])
}
