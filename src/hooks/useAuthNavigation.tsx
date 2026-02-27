import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import {
  ALLOW_MOBILE_QUERY_PARAM,
  IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { isMobile } from '@src/lib/isMobile'
import { PATHS } from '@src/lib/paths'
import { useApp } from '@src/lib/boot'
import { generateSignInUrl } from '@src/routes/utils'

/**
 * A simple hook that listens to the auth state of the app and navigates
 * accordingly.
 */
export function useAuthNavigation() {
  const { auth } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const authState = auth.useAuthState()
  const [searchParams] = useSearchParams()
  const requestingImmediateSignInIfNecessary = searchParams.has(
    IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM
  )
  const hasAllowMobileParam = searchParams.has(ALLOW_MOBILE_QUERY_PARAM)

  // Subscribe to the auth state of the app and navigate accordingly.
  useEffect(() => {
    const onMobile = isMobile()

    if (
      authState.matches('loggedIn') &&
      location.pathname.includes(PATHS.SIGN_IN)
    ) {
      void navigate(PATHS.INDEX)
    } else if (
      authState.matches('loggedOut') &&
      !location.pathname.includes(PATHS.SIGN_IN)
    ) {
      if (requestingImmediateSignInIfNecessary && !isDesktop()) {
        //  window.location.href = generateSignInUrl()
        return
      }

      void navigate(PATHS.SIGN_IN + (location.search || ''))
    } else if (
      authState.matches('loggedOut') &&
      location.pathname.includes(PATHS.SIGN_IN) &&
      !isDesktop() &&
      (!onMobile || hasAllowMobileParam)
    ) {
      // window.location.href = generateSignInUrl()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [authState, location.pathname])
}
