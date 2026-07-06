import { PROJECT_FOLDER } from '@src/lib/constants'
import { webSafeJoin, webSafePathSplit } from '@src/lib/pathUtils'

export const INTERNAL_OPFS_META_FILE = '._meta'

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

export function getOpfsCloudProjectRoot(
  targetPath: string
): string | undefined {
  const normalized = normalizePathForSync(targetPath)
  const parts = webSafePathSplit(normalized).filter(Boolean)
  const projectDirectoryIndex = parts.lastIndexOf(PROJECT_FOLDER)
  if (
    projectDirectoryIndex === -1 ||
    parts.length <= projectDirectoryIndex + 1
  ) {
    return undefined
  }

  return `/${webSafeJoin(parts.slice(0, projectDirectoryIndex + 2))}`
}

export function isProjectRootPath(targetPath: string, projectRoot: string) {
  return normalizePathForSync(targetPath) === normalizePathForSync(projectRoot)
}

export function isOpfsCloudProjectDirectoryPath(targetPath: string) {
  const normalized = normalizePathForSync(targetPath)
  return normalized.endsWith(`/${PROJECT_FOLDER}`)
}
