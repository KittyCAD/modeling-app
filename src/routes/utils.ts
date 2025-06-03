import { NODE_ENV, VITE_KC_SITE_BASE_URL } from '@src/env'
import { isDesktop } from '@src/lib/isDesktop'
import { IS_PLAYWRIGHT_KEY } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'

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

export const IS_NIGHTLY = PACKAGE_NAME.indexOf('-nightly') > -1

export const IS_NIGHTLY_OR_DEBUG = IS_NIGHTLY || APP_VERSION === '0.0.0'

export function getReleaseUrl(version: string = APP_VERSION) {
  if (IS_NIGHTLY_OR_DEBUG || version === 'main') {
    return 'https://github.com/KittyCAD/modeling-app/commits/main'
  }

  return `https://github.com/KittyCAD/modeling-app/releases/tag/v${version}`
}

export function generateSignInUrl() {
  return `${VITE_KC_SITE_BASE_URL}${
    PATHS.SIGN_IN
  }?callbackUrl=${encodeURIComponent(
    typeof window !== 'undefined' && window.location.href.replace('signin', '')
  )}`
}
