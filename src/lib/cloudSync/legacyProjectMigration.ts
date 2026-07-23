import { normalizePathForSync } from '@src/lib/cloudSync/paths'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'

export const LEGACY_CLOUD_PROJECT_MIGRATION_DISMISSED_STORAGE_KEY =
  'zoo.cloudSync.legacyCloudProjectMigration.dismissed'

function pathIsWithinDirectory(targetPath: string, directoryPath: string) {
  const normalizedTargetPath = normalizePathForSync(targetPath)
  const normalizedDirectoryPath = normalizePathForSync(directoryPath)

  return (
    normalizedTargetPath === normalizedDirectoryPath ||
    normalizedTargetPath.startsWith(`${normalizedDirectoryPath}/`)
  )
}

export function getLegacyCloudProjectMigrationSignature(
  projects: readonly HomeProjectEntry[]
) {
  return projects
    .map((project) => project.remoteProjectId ?? project.localProjectPath)
    .filter((id): id is string => Boolean(id))
    .toSorted()
    .join('|')
}

export function getLegacyCloudLocationProjects({
  projects,
  libraries,
  personalCloudRoot,
}: {
  projects: readonly HomeProjectEntry[]
  libraries: readonly ProjectLibrary[]
  personalCloudRoot: string | undefined
}) {
  if (!personalCloudRoot) {
    return []
  }

  const directoryLibraryIds = new Set(
    libraries
      .filter((library) => library.type !== CLOUD_PROJECT_LIBRARY_TYPE)
      .map((library) => library.id)
  )

  return projects.filter((project) => {
    if (
      !project.remoteProjectId ||
      !project.localProjectPath ||
      project.conflict ||
      !project.libraryIds
    ) {
      return false
    }

    if (
      !project.libraryIds.some((libraryId) =>
        directoryLibraryIds.has(libraryId)
      )
    ) {
      return false
    }

    return !pathIsWithinDirectory(project.localProjectPath, personalCloudRoot)
  })
}
