import { webSafePathSplit } from '@src/lib/pathUtils'
import fsZds from '@src/lib/fs-zds'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  isDefaultPersonalCloudProjectLibraryPathSetting,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'

export const DEFAULT_CLOUD_PROJECT_LIBRARY_MATERIALIZATION_PATH_PARTS = [
  'CloudSync',
  'Zoo',
  'local',
] as const
export const INTERNAL_OPFS_META_FILE = '._meta'
const CLOUD_SYNC_EXCLUDED_PATH_PARTS = new Set([
  INTERNAL_OPFS_META_FILE,
  '.git',
  '.hg',
  '.svn',
  '.jj',
])

export async function getCloudProjectLibraryMaterializationDirectoryPath(
  library: Pick<ProjectLibrarySetting, 'source' | 'type'> & { path?: string }
) {
  if (library.type !== CLOUD_PROJECT_LIBRARY_TYPE) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('Expected a cloud project library.')
  }

  if (isDefaultPersonalCloudProjectLibraryPathSetting(library)) {
    return getDefaultCloudProjectLibraryMaterializationDirectoryPath()
  }

  const configuredPath = normalizePathForSync(library.path?.trim() ?? '')
  if (configuredPath) {
    return configuredPath
  }

  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new Error('Expected a cloud project library materialization path.')
}

export async function getDefaultCloudProjectLibraryMaterializationDirectoryPath() {
  return normalizePathForSync(
    fsZds.join(
      await fsZds.getPath('appData'),
      ...DEFAULT_CLOUD_PROJECT_LIBRARY_MATERIALIZATION_PATH_PARTS
    )
  )
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
