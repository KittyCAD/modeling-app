import { PROJECT_FOLDER } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { webSafeJoin, webSafePathSplit } from '@src/lib/pathUtils'

export const INTERNAL_OPFS_META_FILE = '._meta'
export const CLOUD_PROJECT_LIBRARY_FOLDER = 'Zoo'
export const PERSONAL_CLOUD_PROJECT_LIBRARY_FOLDER = 'personal'
export const DEFAULT_CLOUD_PROJECT_DIRECTORY_PATH = `/${webSafeJoin([
  'documents',
  CLOUD_PROJECT_LIBRARY_FOLDER,
  PERSONAL_CLOUD_PROJECT_LIBRARY_FOLDER,
])}`

export async function getDefaultCloudProjectDirectoryPath() {
  if (typeof window !== 'undefined' && window.electron?.os.isMac) {
    try {
      return fsZds.join(
        fsZds.dirname(await fsZds.getPath('appData')),
        'CloudStorage',
        CLOUD_PROJECT_LIBRARY_FOLDER,
        PERSONAL_CLOUD_PROJECT_LIBRARY_FOLDER
      )
    } catch {
      // Fall back to the cross-platform documents location below.
    }
  }

  try {
    return fsZds.join(
      await fsZds.getPath('documents'),
      CLOUD_PROJECT_LIBRARY_FOLDER,
      PERSONAL_CLOUD_PROJECT_LIBRARY_FOLDER
    )
  } catch {
    return DEFAULT_CLOUD_PROJECT_DIRECTORY_PATH
  }
}

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

function getProjectRootFromProjectDirectoryParts(
  parts: readonly string[],
  projectDirectoryParts: readonly string[]
) {
  const maxStartIndex = parts.length - projectDirectoryParts.length - 1
  for (let index = maxStartIndex; index >= 0; index -= 1) {
    const isMatch = projectDirectoryParts.every(
      (part, offset) => parts[index + offset] === part
    )
    if (!isMatch) {
      continue
    }

    return `/${webSafeJoin(
      parts.slice(0, index + projectDirectoryParts.length + 1)
    )}`
  }

  return undefined
}

export function getCloudSyncProjectRoot(
  targetPath: string
): string | undefined {
  const normalized = normalizePathForSync(targetPath)
  const parts = webSafePathSplit(normalized).filter(Boolean)
  return (
    getProjectRootFromProjectDirectoryParts(parts, [PROJECT_FOLDER]) ??
    getProjectRootFromProjectDirectoryParts(parts, [
      CLOUD_PROJECT_LIBRARY_FOLDER,
      PERSONAL_CLOUD_PROJECT_LIBRARY_FOLDER,
    ])
  )
}

export function isProjectRootPath(targetPath: string, projectRoot: string) {
  return normalizePathForSync(targetPath) === normalizePathForSync(projectRoot)
}

export function isCloudSyncProjectDirectoryPath(targetPath: string) {
  const normalized = normalizePathForSync(targetPath)
  return (
    normalized.endsWith(`/${PROJECT_FOLDER}`) ||
    normalized.endsWith(
      `/${webSafeJoin([
        CLOUD_PROJECT_LIBRARY_FOLDER,
        PERSONAL_CLOUD_PROJECT_LIBRARY_FOLDER,
      ])}`
    )
  )
}
