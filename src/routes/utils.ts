import { IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS, getRouterSearchFromRequestUrl } from '@src/lib/paths'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

export {
  APP_VERSION,
  PACKAGE_NAME,
  IS_STAGING,
  IS_STAGING_OR_DEBUG,
  APP_DOWNLOAD_PATH,
  getAppVersion,
  getRefFromVersion,
  getReleaseUrl,
} from '@src/lib/appVersion'

export function generateSignInUrl() {
  const queryParamsNext =
    typeof window !== 'undefined'
      ? getRouterSearchFromRequestUrl(
          window.location.href,
          isDesktop()
        ).replace(IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM, '')
      : ''
  const finalURL =
    typeof window !== 'undefined' &&
    (window.location.origin + encodeURIComponent(queryParamsNext)).replace(
      '?&',
      '?'
    )

  return withSiteBaseURL(
    `${PATHS.SIGN_IN}?callbackUrl=${encodeURIComponent(finalURL)}`
  )
}
