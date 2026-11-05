import { webSafePathSplit } from '@src/lib/pathUtils'
const EXCLUDED_PROJECT_PATH_PARTS = new Set([
  '._meta',
  '.git',
  '.hg',
  '.svn',
  '.jj',
])
export function normalizeProjectPath(targetPath: string) {
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

export function isExcludedProjectPath(targetPath: string) {
  return webSafePathSplit(normalizeProjectPath(targetPath)).some((part) =>
    EXCLUDED_PROJECT_PATH_PARTS.has(part)
  )
}
