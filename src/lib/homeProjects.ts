import { FILE_EXT, PROJECT_IMAGE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import { CLOUD_PROJECT_LIBRARY_ID } from '@src/lib/projectLibraries'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import type {
  HomeProjectEntry,
  HomeProjectEntryContribution,
  HomeProjectStatus,
} from '@src/registry/contracts/homeProjects'

export function getHomeProjectDisplayName(project: HomeProjectEntry) {
  return (project.title || project.name).replace(FILE_EXT, '')
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
    libraryIds: project.cloudProjectId ? [CLOUD_PROJECT_LIBRARY_ID] : undefined,
    name: project.name,
    title: getProjectDisplayName(project),
    localProjectPath: project.path,
    localProjectName: project.name,
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
