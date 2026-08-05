import { PROJECT_FOLDER } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { webSafeJoin, webSafePathSplit } from '@src/lib/pathUtils'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  isDefaultPersonalCloudProjectLibraryPathSetting,
  isLegacyPersonalCloudProjectLibraryPathSetting,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'

export const INTERNAL_OPFS_META_FILE = '._meta'
export const CLOUD_PROJECT_LIBRARY_FOLDER = 'Zoo'
export const PERSONAL_CLOUD_PROJECT_LIBRARY_FOLDER = 'personal'
export const DEFAULT_CLOUD_PROJECT_DIRECTORY_PATH = `/${webSafeJoin([
  'documents',
  PROJECT_FOLDER,
])}`
const CLOUD_SYNC_EXCLUDED_PATH_PARTS = new Set([
  INTERNAL_OPFS_META_FILE,
  '.git',
  '.hg',
  '.svn',
  '.jj',
])

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
      // Fall back to the shared desktop home location below.
    }
  }

  if (typeof window !== 'undefined' && !window.electron) {
    try {
      return fsZds.join(await fsZds.getPath('documents'), PROJECT_FOLDER)
    } catch {
      return DEFAULT_CLOUD_PROJECT_DIRECTORY_PATH
    }
  }

  try {
    return fsZds.join(
      await fsZds.getPath('home'),
      CLOUD_PROJECT_LIBRARY_FOLDER,
      PERSONAL_CLOUD_PROJECT_LIBRARY_FOLDER
    )
  } catch {
    return DEFAULT_CLOUD_PROJECT_DIRECTORY_PATH
  }
}

export async function getCloudProjectLibraryMaterializationDirectoryPath(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'> | undefined
) {
  if (library?.type !== CLOUD_PROJECT_LIBRARY_TYPE) {
    return getDefaultCloudProjectDirectoryPath()
  }

  if (
    isLegacyPersonalCloudProjectLibraryPathSetting(library) ||
    isDefaultPersonalCloudProjectLibraryPathSetting(library)
  ) {
    return getDefaultCloudProjectDirectoryPath()
  }

  return normalizePathForSync(library.path)
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

export function isCloudSyncExcludedPath(targetPath: string) {
  return webSafePathSplit(normalizePathForSync(targetPath)).some((part) =>
    CLOUD_SYNC_EXCLUDED_PATH_PARTS.has(part)
  )
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
