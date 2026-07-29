import {
  cloudSyncStatus,
  getCloudSyncProjectMetadataIndex,
  getCloudSyncProjectModifiedTime,
} from '@src/lib/cloudSync'
import {
  DEFAULT_PROJECT_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
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

export function getDirectoryProjectLibraryValidationError({
  projectDirectoryPath,
  entries,
}: {
  projectDirectoryPath: string
  entries: readonly string[]
}): Error | undefined {
  if (
    !entries.some(
      (entry) =>
        entry.toLowerCase() === PROJECT_SETTINGS_FILE_NAME.toLowerCase()
    )
  ) {
    return undefined
  }

  return new Error(
    `The project library "${projectDirectoryPath}" is also a project because it contains ${PROJECT_SETTINGS_FILE_NAME}. Choose a container folder that holds separate project folders.`
  )
}

export async function validateDirectoryProjectLibrary(
  projectDirectoryPath: string
): Promise<Error | undefined> {
  let entries: string[]
  try {
    entries = await fsZds.readdir(projectDirectoryPath)
  } catch (error) {
    // A manually entered directory can be created later by the project scanner.
    if (isPathNotFoundError(error)) {
      return undefined
    }
    return Promise.reject(error)
  }

  return getDirectoryProjectLibraryValidationError({
    projectDirectoryPath,
    entries,
  })
}

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

export function shouldSendProjectFolderReadProgress(
  folders: readonly Project[] | undefined
) {
  return !folders?.length
}

export async function readProjectsFromProjectDirectory({
  projectDirectoryPath,
  wasmInstancePromise,
  previousProjects,
  signal,
  onProgress,
  validateProjectLibraryRoot = true,
}: {
  projectDirectoryPath: string
  wasmInstancePromise: Promise<ModuleType>
  previousProjects?: Project[]
  signal?: AbortSignal
  onProgress?: (projects: Project[]) => void
  validateProjectLibraryRoot?: boolean
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
  const projectDirectoryEntries = await fsZds.readdir(projectDirectoryPath)
  if (validateProjectLibraryRoot) {
    const validationError = getDirectoryProjectLibraryValidationError({
      projectDirectoryPath,
      entries: projectDirectoryEntries,
    })
    if (validationError) {
      return Promise.reject(validationError)
    }
  }

  const cloudProjectMetadataByPath = cloudSyncStatus.value.enabled
    ? await getCloudSyncProjectMetadataIndex().catch(() => new Map())
    : new Map()
  const entries: ProjectDirectoryEntry[] = []

  // Gotcha: readdir will list folders even without read/write access to the
  // parent directory path. Each candidate still needs to be stat/read checked.
  for (const entry of projectDirectoryEntries) {
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
    } catch {
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

  const { value: canReadWriteProjectDirectory } =
    await canReadWriteDirectory(projectDirectoryPath)
  const wasmInstance = await wasmInstancePromise

  for (const entry of sortProjectDirectoryEntriesByModifiedDesc(entries)) {
    if (signal?.aborted) {
      return projects
    }

    const project = await getProjectInfo(entry.path, wasmInstance)
    const cloudMetadata = cloudProjectMetadataByPath.get(
      normalizeProjectPathForCloudMetadata(entry.path)
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
