import { normalizePathForSync } from '@src/lib/cloudSync/paths'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'

export const LEGACY_CLOUD_PROJECT_MIGRATION_DISMISSED_STORAGE_KEY =
  'zoo.cloudSync.legacyCloudProjectMigration.dismissed'

export type LegacyCloudProjectMigrationFailure = {
  project: Pick<HomeProjectEntry, 'localProjectPath' | 'name' | 'title'>
  reason: unknown
}

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

function projectDisplayName(
  project: Pick<HomeProjectEntry, 'localProjectPath' | 'name' | 'title'>
) {
  return project.title || project.name || project.localProjectPath || 'Project'
}

function migrationErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') {
      return message
    }

    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') {
        return serialized
      }
    } catch {
      // Fall through to the generic message for non-serializable values.
    }
  }

  return 'Unknown error'
}

function cloudSyncedProjectCount(count: number) {
  return `${count} cloud-synced project${count === 1 ? '' : 's'}`
}

export function getLegacyCloudProjectMigrationFailureMessage({
  movedCount,
  failures,
}: {
  movedCount: number
  failures: readonly LegacyCloudProjectMigrationFailure[]
}) {
  const firstFailure = failures[0]
  if (!firstFailure) {
    return ''
  }

  const reason = migrationErrorMessage(firstFailure.reason)

  if (failures.length === 1) {
    const projectName = projectDisplayName(firstFailure.project)
    if (movedCount > 0) {
      return `Moved ${cloudSyncedProjectCount(
        movedCount
      )}, but could not move "${projectName}" into Personal Cloud: ${reason}`
    }

    return `Could not move "${projectName}" into Personal Cloud: ${reason}`
  }

  if (movedCount > 0) {
    return `Moved ${cloudSyncedProjectCount(
      movedCount
    )}, but could not move ${failures.length} others into Personal Cloud. First failure: ${reason}`
  }

  return `Could not move ${failures.length} cloud-synced projects into Personal Cloud. First failure: ${reason}`
}
