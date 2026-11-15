import { viteEnv } from '@src/env'
import { isDesktop } from '@src/lib/isDesktop'

const hasWindow = typeof window !== 'undefined'
const FALLBACK_APP_VERSION = '0.0.0'

function getRealAppVersion(version: string | undefined) {
  if (!version || ['0.0.0', 'dev', 'main'].includes(version)) {
    return undefined
  }

  return version
}

function getWebAppVersion(commitSha: string | undefined) {
  if (!commitSha || commitSha.length < 7) {
    return undefined
  }

  return commitSha.slice(0, 7)
}

export function getAppVersion({
  gitCommitSha,
  isDesktop,
}: {
  gitCommitSha: string | undefined
  isDesktop: boolean
}) {
  if (isDesktop) {
    const packageJson = hasWindow ? window.electron?.packageJson : undefined
    const electronVersion =
      packageJson &&
      'version' in packageJson &&
      typeof packageJson.version === 'string'
        ? packageJson.version
        : undefined
    return getRealAppVersion(electronVersion) ?? FALLBACK_APP_VERSION
  }

  return getWebAppVersion(gitCommitSha)
}

export const APP_VERSION = getAppVersion({
  gitCommitSha: viteEnv().MODELING_APP_COMMIT_SHA,
  isDesktop: isDesktop(),
})

export const PACKAGE_NAME =
  hasWindow && window.electron
    ? window.electron.packageJson.name
    : 'zoo-modeling-app'

export const IS_STAGING = PACKAGE_NAME.indexOf('-staging') > -1

export const IS_STAGING_OR_DEBUG =
  IS_STAGING ||
  (isDesktop()
    ? APP_VERSION === FALLBACK_APP_VERSION
    : viteEnv().VERCEL_ENV !== 'production')

export const APP_DOWNLOAD_PATH = `design-studio/download${IS_STAGING_OR_DEBUG ? '/staging' : ''}`

export function getRefFromVersion(version: string | undefined) {
  const hash = version?.split('.').pop()
  if (hash && hash.length === 7) {
    return hash
  }

  return undefined
}

export function getReleaseUrl(version: string | undefined = APP_VERSION) {
  if (!version) {
    return 'https://github.com/KittyCAD/modeling-app/releases'
  }

  const ref = getRefFromVersion(version)
  if (IS_STAGING_OR_DEBUG || ref || version === 'main') {
    return `https://github.com/KittyCAD/modeling-app/commit/${ref ?? 'main'}`
  }

  return `https://github.com/KittyCAD/modeling-app/releases/tag/v${version}`
}
