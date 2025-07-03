import { NODE_ENV } from '@src/env'
import { isDesktop } from '@src/lib/isDesktop'
import {
  IS_PLAYWRIGHT_KEY,
  IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM,
} from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

const isTestEnv = window?.localStorage.getItem(IS_PLAYWRIGHT_KEY) === 'true'

export const APP_VERSION =
  isTestEnv && NODE_ENV === 'development'
    ? '11.22.33'
    : isDesktop()
      ? // @ts-ignore
        window.electron.packageJson.version
      : 'main'

export const PACKAGE_NAME = isDesktop()
  ? window.electron.packageJson.name
  : 'zoo-modeling-app'

export const IS_STAGING = PACKAGE_NAME.indexOf('-staging') > -1

export const IS_STAGING_OR_DEBUG = IS_STAGING || APP_VERSION === '0.0.0'

export function getRefFromVersion(version: string) {
  const hash = version.split('.').pop()
  if (hash && hash.length === 7) {
    return hash
  }

  return undefined
}

export function getReleaseUrl(version: string = APP_VERSION) {
  if (IS_STAGING_OR_DEBUG || version === 'main') {
    const ref = getRefFromVersion(version) ?? 'main'
    return `https://github.com/KittyCAD/modeling-app/commit/${ref}`
  }

  return `https://github.com/KittyCAD/modeling-app/releases/tag/v${version}`
}

export function generateSignInUrl() {
  const queryParamsNext = window.location.search.replace(
    IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM,
    ''
  )
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
