import { viteEnv } from '@src/env'
import { IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS, getRouterSearchFromRequestUrl } from '@src/lib/paths'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

const hasWindow = typeof window !== 'undefined'
const FALLBACK_APP_VERSION = '0.0.0'

function getRealAppVersion(version: string | undefined) {
  if (!version || ['0.0.0', 'dev', 'main'].includes(version)) {
    return undefined
  }

  return version
}

function getVercelAppVersion(
  commitRef: string | undefined,
  commitSha: string | undefined
) {
  const versionTag = commitRef?.match(/^v(\d+\.\d+\.\d+)$/)
  if (versionTag) {
    return versionTag[1]
  }

  if (!commitSha || commitSha.length < 7) {
    return undefined
  }

  return commitSha.slice(0, 7)
}

export function getAppVersion({
  isDesktop,
  vercelGitCommitRef,
  vercelGitCommitSha,
}: {
  isDesktop: boolean
  vercelGitCommitRef: string | undefined
  vercelGitCommitSha: string | undefined
}) {
  if (isDesktop) {
    const electronVersion = hasWindow
      ? (window.electron?.packageJson as { version?: string } | undefined)
          ?.version
      : undefined
    return getRealAppVersion(electronVersion) ?? FALLBACK_APP_VERSION
  }

  return (
    getVercelAppVersion(vercelGitCommitRef, vercelGitCommitSha) ??
    FALLBACK_APP_VERSION
  )
}

export const APP_VERSION = getAppVersion({
  isDesktop: isDesktop(),
  vercelGitCommitRef: viteEnv().VERCEL_GIT_COMMIT_REF,
  vercelGitCommitSha: viteEnv().VERCEL_GIT_COMMIT_SHA,
})

export const PACKAGE_NAME =
  hasWindow && window.electron
    ? window.electron.packageJson.name
    : 'zoo-modeling-app'

export const IS_STAGING = PACKAGE_NAME.indexOf('-staging') > -1

export const IS_STAGING_OR_DEBUG =
  IS_STAGING ||
  APP_VERSION === FALLBACK_APP_VERSION ||
  getRefFromVersion(APP_VERSION) !== undefined

export const APP_DOWNLOAD_PATH = `design-studio/download${IS_STAGING_OR_DEBUG ? '/staging' : ''}`

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
