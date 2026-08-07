import { PROJECT_IMAGE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import type { ProjectLibraryRealizationContribution } from '@src/registry/contracts/projectLibraries'

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

/**
 * Converts one concrete project folder into a local realization. Cloud project
 * IDs are copied as observations only; identity resolution and duplicate
 * policy are owned by cloudSync.
 */
export function projectLibraryRealizationFromProject(
  project: Project,
  library?: ProjectLibrary
): ProjectLibraryRealizationContribution {
  const modified = getLatestModifiedTime(project)

  return {
    ...(library ? { library } : {}),
    name: project.name,
    title: getProjectDisplayName(project),
    localProjectPath: project.path,
    localProjectName: project.name,
    cloudProjectId: project.cloudProjectId,
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
