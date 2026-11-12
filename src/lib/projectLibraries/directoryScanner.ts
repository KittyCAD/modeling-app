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
import {
  canReadWriteDirectory,
  getProjectInfo,
  isPathNotFoundError,
  mkdirOrNOOP,
} from '@src/lib/desktop'
import type { FileStat } from '@src/lib/fileSystem/fileOperations'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { reportRejection } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

const PROJECT_FOLDER_PROGRESS_CHUNK_SIZE = 12

type ProjectDirectoryEntry = {
  name: string
  path: string
  modified: number
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
async function deleteLegacyCloudConflictCopyProject(
  fileOperations: FileOperationsRegistryService,
  projectPath: string
) {
  try {
    await fileOperations.remove(projectPath)
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
  fileOperations,
  projectDirectoryPath,
  wasmInstancePromise,
  previousProjects,
  signal,
  onProgress,
  onProjectStatFailures,
}: {
  fileOperations: FileOperationsRegistryService
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

  await mkdirOrNOOP(fileOperations, projectDirectoryPath)
  const cloudProjectMetadataByPath = cloudSyncStatus.value.enabled
    ? await getCloudSyncProjectMetadataIndex().catch(() => new Map())
    : new Map()
  const entries: ProjectDirectoryEntry[] = []
  let firstProjectStatFailure: unknown
  let projectStatFailureCount = 0

  // Gotcha: readdir will list folders even without read/write access to the
  // parent directory path. Each candidate still needs to be stat/read checked.
  for (const entry of await fileOperations.readDirectory(
    projectDirectoryPath
  )) {
    if (signal?.aborted) {
      return projects
    }
    if (entry.startsWith('.')) {
      continue
    }

    const projectPath = fsZds.join(projectDirectoryPath, entry)
    let stat: FileStat
    try {
      stat = await fileOperations.stat(projectPath)
    } catch (error) {
      if (!isPathNotFoundError(error)) {
        if (projectStatFailureCount === 0) {
          firstProjectStatFailure = error
        }
        projectStatFailureCount += 1
      }
      continue
    }
    if (stat.kind !== 'directory') {
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
          stat.modifiedAt
        ) ?? stat.modifiedAt,
    })
  }

  if (projectStatFailureCount > 0) {
    onProjectStatFailures?.({
      error: firstProjectStatFailure,
      count: projectStatFailureCount,
    })
  }

  const { value: canReadWriteProjectDirectory } = await canReadWriteDirectory(
    fileOperations,
    projectDirectoryPath
  )
  const wasmInstance = await wasmInstancePromise

  for (const entry of sortProjectDirectoryEntriesByModifiedDesc(entries)) {
    if (signal?.aborted) {
      return projects
    }

    const cloudMetadata = cloudProjectMetadataByPath.get(
      normalizeProjectPathForCloudMetadata(entry.path)
    )
    if (cloudMetadata?.syncExcluded?.reason === 'conflict-copy') {
      await deleteLegacyCloudConflictCopyProject(
        fileOperations,
        entry.path
      ).catch(reportRejection)
      continue
    }

    const project = await getProjectInfo(
      fileOperations,
      entry.path,
      wasmInstance
    )
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
