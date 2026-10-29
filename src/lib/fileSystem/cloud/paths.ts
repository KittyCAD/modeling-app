import { webSafePathSplit } from '@src/lib/pathUtils'
const CLOUD_SYNC_EXCLUDED_PATH_PARTS = new Set([
  '._meta',
  '.git',
  '.hg',
  '.svn',
  '.jj',
])
export function normalizePathForSync(targetPath: string) {
  const normalized = targetPath.replaceAll('\\', '/')
  if (normalized === '/') {
    return normalized
  }
  return normalized.replace(/\/+$/g, '')
}

export function normalizeRelativePath(relativePath: string) {
  return relativePath
    .replaceAll('\\', '/')
    .replace(/^\/+/g, '')
    .replace(/^(?:\.\/)+/g, '')
}

export function isCloudSyncExcludedPath(targetPath: string) {
  return webSafePathSplit(normalizePathForSync(targetPath)).some((part) =>
    CLOUD_SYNC_EXCLUDED_PATH_PARTS.has(part)
  )
}

export function isProjectRootPath(targetPath: string, projectRoot: string) {
  return normalizePathForSync(targetPath) === normalizePathForSync(projectRoot)
}
