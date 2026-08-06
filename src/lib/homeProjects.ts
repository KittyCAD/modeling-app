import { FILE_EXT, PROJECT_IMAGE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import type {
  HomeProjectEntry,
  HomeProjectEntryContribution,
  HomeProjectStatus,
} from '@src/registry/contracts/homeProjects'

export function getHomeProjectDisplayName(project: HomeProjectEntry) {
  return (project.title || project.name).replace(FILE_EXT, '')
}

export function shouldDeleteRemoteOnHomeProjectDelete(
  project: Pick<HomeProjectEntry, 'libraryType' | 'remoteProjectId'>
) {
  return Boolean(
    project.remoteProjectId &&
      project.libraryType === CLOUD_PROJECT_LIBRARY_TYPE
  )
}

export function shouldPreserveRemoteOnHomeProjectDelete(
  project: Pick<
    HomeProjectEntry,
    'libraryType' | 'localProjectPath' | 'remoteProjectId'
  >
): boolean {
  return Boolean(
    project.localProjectPath &&
      project.remoteProjectId &&
      !shouldDeleteRemoteOnHomeProjectDelete(project)
  )
}

export function getHomeProjectDeleteWarningMessage(
  project: HomeProjectEntry,
  projectDisplayName = getHomeProjectDisplayName(project)
) {
  if (shouldPreserveRemoteOnHomeProjectDelete(project)) {
    return `This will delete the local copy of "${projectDisplayName}". The cloud version will not be deleted.`
  }

  return `This will permanently delete the project "${projectDisplayName}" and all its contents.`
}

function getLatestModifiedTime(entry: FileEntry): number | undefined {
  const ownModified = entry.metadata?.modified ?? undefined
  const childModified =
    entry.children
      ?.map(getLatestModifiedTime)
      .filter((modified): modified is number => modified !== undefined)
      .toSorted((a, b) => b - a)[0] ?? undefined

  if (ownModified === undefined) {
    return childModified
  }
  if (childModified === undefined) {
    return ownModified
  }
  return Math.max(ownModified, childModified)
}

export function homeProjectEntryStatusFromProject(
  project: Project
): HomeProjectStatus {
  if (project.cloudConflict) {
    return 'conflicted'
  }
  if (project.cloudProjectId) {
    return 'synced'
  }
  return 'local'
}

export function homeProjectEntryFromProject(
  project: Project
): HomeProjectEntryContribution {
  const modified = getLatestModifiedTime(project)

  return {
    source: 'local',
    status: homeProjectEntryStatusFromProject(project),
    name: project.name,
    title: getProjectDisplayName(project),
    localProjectPath: project.path,
    localProjectName: project.name,
    libraryPath: project.libraryPath,
    libraryType: project.libraryType,
    remoteProjectId: project.cloudProjectId,
    modified,
    defaultFile: project.default_file,
    kclFileCount: project.kcl_file_count,
    directoryCount: project.directory_count,
    readWriteAccess: project.readWriteAccess,
    thumbnail: {
      type: 'local',
      path: fsZds.join(project.path, PROJECT_IMAGE_NAME),
    },
    conflict: project.cloudConflict,
  }
}
