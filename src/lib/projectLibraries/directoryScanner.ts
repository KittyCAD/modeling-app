import {
  canReadWriteDirectory,
  getProjectInfo,
  isPathNotFoundError,
  mkdirOrNOOP,
} from '@src/lib/desktop'
import type { FileStat } from '@src/lib/fileSystem/fileOperations'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
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

export function shouldSendProjectFolderReadProgress(
  folders: readonly Project[] | undefined
) {
  return !folders?.length
}

/** List projects in one directory library without changing their storage paths. */
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
      modified: stat.modifiedAt,
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

    const project = await getProjectInfo(
      fileOperations,
      entry.path,
      wasmInstance
    )
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
