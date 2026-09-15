import {
  cloudSyncStatus,
  getCloudSyncProjectMetadataIndex,
  getCloudSyncProjectModifiedTime,
} from '@src/lib/cloudSync'
import { reportCloudSyncConflictCopyDetected } from '@src/lib/cloudSync/clientErrorReporting'
import {
  clearLegacyConflictCopyReferences,
  clearOutboxEntriesTouchingProject,
  deleteProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import { DEFAULT_PROJECT_NAME } from '@src/lib/constants'
import {
  canReadWriteDirectory,
  getProjectInfo,
  isPathNotFoundError,
  mkdirOrNOOP,
} from '@src/lib/desktop'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import type { Project } from '@src/lib/project'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import { reportRejection } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

const PROJECT_FOLDER_PROGRESS_CHUNK_SIZE = 12

type ProjectDirectoryEntry = {
  name: string
  path: string
  modified: number
}

const scheduledProjectDirectoryNameSyncs = new Set<string>()

function projectDirectoryEntryNamesToProjects(
  projectDirectoryPath: string,
  names: Iterable<string>
) {
  return Array.from(names, (name) => ({
    name,
    path: fsZds.join(projectDirectoryPath, name),
    children: [],
  }))
}

function sameFilesystemEntry(
  left: Awaited<ReturnType<typeof fsZds.stat>>,
  right: Awaited<ReturnType<typeof fsZds.stat>>
) {
  if (
    (left.dev === 0 && left.ino === 0) ||
    (right.dev === 0 && right.ino === 0)
  ) {
    return false
  }

  return left.dev === right.dev && left.ino === right.ino
}

async function canRenameProjectDirectoryTo({
  projectPath,
  targetPath,
}: {
  projectPath: string
  targetPath: string
}) {
  const projectStat = await fsZds.stat(projectPath)

  try {
    const targetStat = await fsZds.stat(targetPath)
    return sameFilesystemEntry(projectStat, targetStat)
  } catch (error) {
    if (isPathNotFoundError(error)) {
      return true
    }
    return Promise.reject(error)
  }
}

export async function syncProjectDirectoryNameFromTitle({
  project,
  projectDirectoryEntryNames,
}: {
  project: Project
  projectDirectoryEntryNames: Iterable<string>
}) {
  const title = project.title?.trim()
  if (!title || !project.readWriteAccess) {
    return undefined
  }

  const preferredProjectDirectoryName = getProjectDirectoryNameFromTitle(
    title,
    DEFAULT_PROJECT_NAME
  )
  const projectDirectoryPath = fsZds.dirname(project.path)
  const siblingNames = new Set(projectDirectoryEntryNames)
  siblingNames.delete(project.name)
  const targetProjectDirectoryName = getUniqueProjectName(
    preferredProjectDirectoryName,
    projectDirectoryEntryNamesToProjects(projectDirectoryPath, siblingNames)
  )

  if (targetProjectDirectoryName === project.name) {
    return undefined
  }

  const targetPath = fsZds.join(
    projectDirectoryPath,
    targetProjectDirectoryName
  )
  if (
    !(await canRenameProjectDirectoryTo({
      projectPath: project.path,
      targetPath,
    }))
  ) {
    return undefined
  }

  await fsZds.rename(project.path, targetPath)
  return targetProjectDirectoryName
}

function projectsByDirectory(projects: readonly Project[]) {
  const projectsByDirectoryPath = new Map<string, Project[]>()
  for (const project of projects) {
    const projectDirectoryPath = fsZds.dirname(project.path)
    projectsByDirectoryPath.set(projectDirectoryPath, [
      ...(projectsByDirectoryPath.get(projectDirectoryPath) ?? []),
      project,
    ])
  }

  return projectsByDirectoryPath
}

export function scheduleProjectDirectoryNameSyncFromTitles({
  projects,
  onProjectDirectoriesRenamed,
}: {
  projects: readonly Project[]
  onProjectDirectoriesRenamed?: () => void
}) {
  const projectsGroupedByDirectory = projectsByDirectory(projects).entries()
  const syncGroups = Array.from(projectsGroupedByDirectory).filter(
    ([projectDirectoryPath]) => {
      if (scheduledProjectDirectoryNameSyncs.has(projectDirectoryPath)) {
        return false
      }

      scheduledProjectDirectoryNameSyncs.add(projectDirectoryPath)
      return true
    }
  )

  if (syncGroups.length === 0) {
    return
  }

  queueMicrotask(() => {
    void (async () => {
      let renamed = false
      for (const [projectDirectoryPath, directoryProjects] of syncGroups) {
        const currentProjectDirectoryEntryNames = new Set(
          await fsZds.readdir(projectDirectoryPath)
        )

        for (const project of directoryProjects) {
          let targetProjectDirectoryName: string | undefined
          try {
            targetProjectDirectoryName =
              await syncProjectDirectoryNameFromTitle({
                project,
                projectDirectoryEntryNames: currentProjectDirectoryEntryNames,
              })
          } catch (error) {
            reportRejection(error)
            continue
          }

          if (targetProjectDirectoryName) {
            currentProjectDirectoryEntryNames.delete(project.name)
            currentProjectDirectoryEntryNames.add(targetProjectDirectoryName)
            renamed = true
          }
        }
      }

      if (renamed) {
        onProjectDirectoriesRenamed?.()
      }
    })()
      .catch(reportRejection)
      .finally(() => {
        for (const [projectDirectoryPath] of syncGroups) {
          scheduledProjectDirectoryNameSyncs.delete(projectDirectoryPath)
        }
      })
  })
}

export function sortProjectDirectoryEntriesByModifiedDesc(
  entries: ProjectDirectoryEntry[]
) {
  return entries.toSorted(
    (a, b) => b.modified - a.modified || a.name.localeCompare(b.name)
  )
}

function normalizeProjectPathForCloudMetadata(projectPath: string) {
  return projectPath.replaceAll('\\', '/').replace(/\/+$/g, '')
}

/**
 * Deletes conflict-copy project folders created by older cloud sync builds.
 *
 * TODO: Delete this cleanup after cloud_sync_conflict_copy_detected client error
 * reports drop to zero, confirming generated conflict-copy projects have aged
 * out of active clients.
 */
async function deleteLegacyCloudConflictCopyProject(projectPath: string) {
  try {
    await fsZds.rm(projectPath, { recursive: true })
  } catch (error) {
    if (!isPathNotFoundError(error)) {
      return Promise.reject(error)
    }
  }

  await clearOutboxEntriesTouchingProject(projectPath)
  await clearLegacyConflictCopyReferences(projectPath)
  await deleteProjectMetadata(projectPath)
  reportCloudSyncConflictCopyDetected()
}

export function shouldSendProjectFolderReadProgress(
  folders: readonly Project[] | undefined
) {
  return !folders?.length
}

/**
 * Scans one directory library for concrete project folders. Cloud sync metadata
 * is used only to enrich local observations with modified/conflict/cloud ID
 * hints; duplicate detection and cleanup policy are handled after discovery.
 */
export async function readProjectsFromProjectDirectory({
  projectDirectoryPath,
  wasmInstancePromise,
  previousProjects,
  signal,
  onProgress,
  onProjectStatFailures,
}: {
  projectDirectoryPath: string
  wasmInstancePromise: Promise<ModuleType>
  previousProjects?: Project[]
  signal?: AbortSignal
  onProgress?: (projects: Project[]) => void
  onProjectStatFailures?: (failure: { error: unknown; count: number }) => void
}) {
  const projects: Project[] = []
  const canSendProgress = shouldSendProjectFolderReadProgress(previousProjects)

  const sendProgress = (folders: Project[]) => {
    if (signal?.aborted) {
      return
    }
    onProgress?.(folders)
  }

  await mkdirOrNOOP(projectDirectoryPath)
  const cloudProjectMetadataByPath = cloudSyncStatus.value.enabled
    ? await getCloudSyncProjectMetadataIndex().catch(() => new Map())
    : new Map()
  const entries: ProjectDirectoryEntry[] = []
  let firstProjectStatFailure: unknown
  let projectStatFailureCount = 0

  // Gotcha: readdir will list folders even without read/write access to the
  // parent directory path. Each candidate still needs to be stat/read checked.
  for (const entry of await fsZds.readdir(projectDirectoryPath)) {
    if (signal?.aborted) {
      return projects
    }
    if (entry.startsWith('.')) {
      continue
    }

    const projectPath = fsZds.join(projectDirectoryPath, entry)
    let stat: Awaited<ReturnType<typeof fsZds.stat>>
    try {
      stat = await fsZds.stat(projectPath)
    } catch (error) {
      if (!isPathNotFoundError(error)) {
        if (projectStatFailureCount === 0) {
          firstProjectStatFailure = error
        }
        projectStatFailureCount += 1
      }
      continue
    }
    if (!(stat.mode & fsZdsConstants.S_IFDIR)) {
      continue
    }

    entries.push({
      name: entry,
      path: projectPath,
      modified:
        getCloudSyncProjectModifiedTime(
          cloudProjectMetadataByPath.get(
            normalizeProjectPathForCloudMetadata(projectPath)
          ),
          stat.mtimeMs
        ) ?? stat.mtimeMs,
    })
  }

  if (projectStatFailureCount > 0) {
    onProjectStatFailures?.({
      error: firstProjectStatFailure,
      count: projectStatFailureCount,
    })
  }

  const { value: canReadWriteProjectDirectory } =
    await canReadWriteDirectory(projectDirectoryPath)
  const wasmInstance = await wasmInstancePromise

  for (const entry of sortProjectDirectoryEntriesByModifiedDesc(entries)) {
    if (signal?.aborted) {
      return projects
    }

    const cloudMetadata = cloudProjectMetadataByPath.get(
      normalizeProjectPathForCloudMetadata(entry.path)
    )
    if (cloudMetadata?.syncExcluded?.reason === 'conflict-copy') {
      await deleteLegacyCloudConflictCopyProject(entry.path).catch(
        reportRejection
      )
      continue
    }

    const project = await getProjectInfo(entry.path, wasmInstance)
    project.cloudProjectId ??= cloudMetadata?.remoteProjectId
    project.cloudConflict = cloudMetadata?.conflict
    if (project.metadata) {
      project.metadata.modified = getCloudSyncProjectModifiedTime(
        cloudMetadata,
        project.metadata.modified
      )
    }
    if (
      project.kcl_file_count === 0 &&
      project.readWriteAccess &&
      canReadWriteProjectDirectory
    ) {
      continue
    }

    projects.push(project)
    if (
      canSendProgress &&
      projects.length % PROJECT_FOLDER_PROGRESS_CHUNK_SIZE === 0
    ) {
      sendProgress([...projects])
    }
  }

  sendProgress(projects)
  return projects
}
