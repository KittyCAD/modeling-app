import { base64ToString, stringToBase64 } from '@src/lib/base64'
import { webSafePathSplit } from '@src/lib/pathUtils'
import { isArray } from '@src/lib/utils'

/** A stable, filesystem-safe namespace that survives token rotation. */
export function getCloudSyncCacheScope(
  userId: string | undefined,
  baseUrl: string | undefined
) {
  return userId && baseUrl
    ? `v1-${stringToBase64(
        JSON.stringify([baseUrl.replace(/\/+$/g, ''), userId])
      )
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '')}`
    : undefined
}
export function getCloudSyncCacheScopeFromPath(path: string) {
  const parts = webSafePathSplit(path.replaceAll('\\', '/'))
  const index = parts.indexOf('.accounts')
  const scope = index >= 0 ? parts[index + 1] : undefined
  if (!scope?.startsWith('v1-')) return undefined
  try {
    const identity: unknown = JSON.parse(
      base64ToString(scope.slice(3).replaceAll('-', '+').replaceAll('_', '/'))
    )
    return isArray(identity) &&
      identity.length === 2 &&
      identity.every((part) => typeof part === 'string')
      ? scope
      : undefined
  } catch {
    return undefined
  }
}
