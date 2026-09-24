import {
  ALLOW_MOBILE_QUERY_PARAM,
  IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { isMobile } from '@src/lib/isMobile'
import { reportRejection } from '@src/lib/trap'
import {
  defineAppNavigationIntentContribution,
  type AppNavigationIntentContribution,
} from '@src/registry/contracts/appNavigation'
import {
  startSignInIntent,
  type StartSignInRequest,
} from '@src/registry/contracts/auth'
import type { AppUrlService, AppUrlState } from '@src/registry/contracts/appUrl'
import { generateSignInUrl } from '@src/routes/utils'

export interface StartSignInDependencies {
  getAppUrl: () => AppUrlService
  startDesktopSignIn: (environment?: string) => Promise<void>
  isDesktop: () => boolean
  isMobile: () => boolean
  redirectToHostedSignIn: () => void
}

const currentUrlState = (appUrl: AppUrlService): AppUrlState => {
  const location = appUrl.getLocation()
  return { search: location.search, hash: location.hash }
}

function shouldUseHostedSignIn(
  request: StartSignInRequest,
  urlState: AppUrlState,
  dependencies: StartSignInDependencies
) {
  if (dependencies.isDesktop()) return false
  if (request.reason === 'session-expired' || request.reason === 'user') {
    return true
  }

  const search = new URLSearchParams(urlState.search)
  return (
    search.has(IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM) ||
    !dependencies.isMobile() ||
    search.has(ALLOW_MOBILE_QUERY_PARAM)
  )
}

/** Build the auth-owned handler for entering and optionally starting sign-in. */
export function createStartSignInIntentContribution(
  dependencies: StartSignInDependencies
): AppNavigationIntentContribution {
  return defineAppNavigationIntentContribution(
    startSignInIntent,
    async (request) => {
      const appUrl = dependencies.getAppUrl()
      const urlState =
        request.reason === 'startup' ? request.startup : currentUrlState(appUrl)

      if (shouldUseHostedSignIn(request, urlState, dependencies)) {
        dependencies.redirectToHostedSignIn()
        return
      }

      void appUrl.navigate(
        appUrl.formatUrl({
          destination: { type: 'sign-in' },
          ...urlState,
        }),
        { replace: request.reason === 'startup' }
      )

      if (
        dependencies.isDesktop() &&
        (request.reason === 'session-expired' || request.reason === 'user')
      ) {
        void dependencies
          .startDesktopSignIn(
            request.reason === 'user' ? request.environment : undefined
          )
          .catch(reportRejection)
      }
    }
  )
}

export const defaultStartSignInDependencies = (
  getAppUrl: () => AppUrlService,
  startDesktopSignIn: (environment?: string) => Promise<void>
): StartSignInDependencies => ({
  getAppUrl,
  startDesktopSignIn,
  isDesktop,
  isMobile,
  redirectToHostedSignIn: () => {
    window.location.href = generateSignInUrl()
  },
})
