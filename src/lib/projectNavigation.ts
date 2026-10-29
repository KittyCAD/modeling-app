import {
  formatCloudProjectUrl,
  isValidProjectFilePath,
} from '@src/lib/cloudProjectOpen'
import {
  getCloudProjectLibraryMaterializationDirectoryPath,
  normalizePathForSync,
} from '@src/lib/cloudSync/paths'
import { isDesktop } from '@src/lib/isDesktop'
import {
  PATHS,
  safeEncodeForRouterPaths,
  toProjectRelativePath,
} from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import {
  isPersonalCloudProjectLibrarySetting,
  isPathInDirectoryProjectLibrary,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import type {
  CloudProjectRelationship,
  CloudSyncRegistryService,
} from '@src/registry/contracts/cloudSync'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'

export type ProjectRouteSource = Pick<
  Project,
  'path' | 'cloudProjectId' | 'cloudSource'
>

function cloudFileUrl(
  id: string,
  projectPath: string,
  filePath: string,
  search: string
) {
  const relative = toProjectRelativePath(projectPath, filePath)
  return formatCloudProjectUrl(
    id,
    relative && isValidProjectFilePath(relative) ? relative : undefined,
    search
  )
}

export function getProjectFileUrl(
  project: ProjectRouteSource,
  filePath: string,
  search = ''
) {
  return project.cloudSource
    ? cloudFileUrl(project.cloudSource.id, project.path, filePath, search)
    : `${PATHS.FILE}/${safeEncodeForRouterPaths(filePath)}${search ? `?${new URLSearchParams(search)}` : ''}`
}

export function getHomeProjectUrl(project: HomeProjectEntry) {
  if (
    project.remoteProjectId &&
    (!isDesktop() ||
      (project.cloudRelationshipId &&
        (!project.localProjectPath ||
          project.canonicalCloudProjectPath === project.localProjectPath)))
  ) {
    return formatCloudProjectUrl(project.remoteProjectId)
  }
  return isDesktop() && project.readWriteAccess && project.defaultFile
    ? `${PATHS.FILE}/${safeEncodeForRouterPaths(project.defaultFile)}`
    : undefined
}

export async function resolveProjectFileUrl({
  project,
  filePath,
  search = '',
  libraries,
  cloudSync,
  getRelationships,
}: {
  project: ProjectRouteSource
  filePath: string
  search?: string
  libraries: readonly ProjectLibrarySetting[]
  cloudSync: Pick<CloudSyncRegistryService, 'getProjectMetadata' | 'syncNow'>
  getRelationships: () => readonly CloudProjectRelationship[]
}) {
  if (project.cloudSource) return getProjectFileUrl(project, filePath, search)
  if (isDesktop()) {
    const library = libraries.find(isPersonalCloudProjectLibrarySetting)
    const directory =
      library &&
      (await getCloudProjectLibraryMaterializationDirectoryPath(library))
    if (
      !directory ||
      !isPathInDirectoryProjectLibrary(project.path, directory)
    ) {
      return getProjectFileUrl(project, filePath, search)
    }
  }
  const metadata = await cloudSync.getProjectMetadata(project.path)
  let id = metadata?.remoteProjectId ?? project.cloudProjectId
  const relationship =
    id && getRelationships().find((entry) => entry.remoteProjectId === id)
  const canonical =
    relationship &&
    relationship.canonicalRealization?.realization.localProjectPath
  if (
    isDesktop() &&
    (metadata?.syncExcluded ||
      (canonical &&
        normalizePathForSync(canonical) !== normalizePathForSync(project.path)))
  ) {
    return getProjectFileUrl(project, filePath, search)
  }
  // New cloud projects need the server UUID before they can be opened.
  id ??= (await cloudSync.syncNow(project.path)).remoteProjectId
  return cloudFileUrl(id, project.path, filePath, search)
}

export function withProjectSubRoute(projectUrl: string, subRoute: string) {
  const target = new URL(projectUrl, 'https://app.zoo.dev')
  const suffix = new URL(subRoute, 'https://app.zoo.dev')
  target.pathname += suffix.pathname
  for (const [key, value] of suffix.searchParams)
    target.searchParams.set(key, value)
  return target.pathname + target.search
}
