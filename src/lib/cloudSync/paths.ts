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
export const ATPROTO_SYNC_META_FILE = '._atproto_sync'
export const CLOUD_PROJECT_LIBRARY_FOLDER = 'Zoo'
export const PERSONAL_CLOUD_PROJECT_LIBRARY_FOLDER = 'personal'
export const DEFAULT_CLOUD_PROJECT_DIRECTORY_PATH = `/${webSafeJoin([
  'documents',
  PROJECT_FOLDER,
])}`
const CLOUD_SYNC_EXCLUDED_PATH_PARTS = new Set([
  INTERNAL_OPFS_META_FILE,
  ATPROTO_SYNC_META_FILE,
  '.git',
  '.hg',
  '.svn',
  '.jj',
])

export async function getCloudProjectLibraryMaterializationDirectoryPath(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'>
) {
  if (library.type !== CLOUD_PROJECT_LIBRARY_TYPE) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('Expected a cloud project library.')
  }

  if (
    isLegacyPersonalCloudProjectLibraryPathSetting(library) ||
    isDefaultPersonalCloudProjectLibraryPathSetting(library)
  ) {
    return getDefaultCloudProjectDirectoryPath()
  }

  return normalizePathForSync(library.path)
}

async function getDefaultCloudProjectDirectoryPath() {
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
