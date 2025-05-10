import { NODE_ENV } from '@src/env'
import { isDesktop } from '@src/lib/isDesktop'
import { IS_PLAYWRIGHT_KEY } from '@src/lib/constants'

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

export const IS_STAGING_OR_DEBUG =
  IS_STAGING || APP_VERSION === '0.0.0' || APP_VERSION === '11.22.33'

export function getReleaseUrl(version: string = APP_VERSION) {
  return `https://github.com/KittyCAD/modeling-app/releases/tag/${
    IS_STAGING ? 'staging-' : ''
  }v${version}`
}
