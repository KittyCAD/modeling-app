import {
  createNewProjectDirectory,
  isPathNotFoundError,
} from '@src/lib/desktop'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import { getProjectTitleFromUniqueDirectoryName } from '@src/lib/projectName'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

async function getProjectDirectoryEntryNames(projectDirectoryPath: string) {
  try {
    return await fsZds.readdir(projectDirectoryPath)
  } catch (error) {
    if (isPathNotFoundError(error)) {
      return []
    }
    return Promise.reject(error)
  }
}

function projectEntriesFromNames(
  projectDirectoryPath: string,
  names: readonly string[]
): FileEntry[] {
  return names.map((name) => ({
    name,
    path: fsZds.join(projectDirectoryPath, name),
    children: [],
  }))
}

export async function createProjectInLocalDirectory({
  projectDirectoryPath,
  requestedProjectName,
  requestedProjectTitle,
  wasmInstancePromise,
}: {
  projectDirectoryPath: string
  requestedProjectName: string
  requestedProjectTitle: string
  wasmInstancePromise: Promise<ModuleType> | ModuleType
}): Promise<Project> {
  const existingProjectNames =
    await getProjectDirectoryEntryNames(projectDirectoryPath)
  const uniqueProjectName = getUniqueProjectName(
    requestedProjectName,
    projectEntriesFromNames(projectDirectoryPath, existingProjectNames)
  )
  const uniqueProjectTitle = getProjectTitleFromUniqueDirectoryName({
    requestedProjectTitle,
    requestedProjectDirectoryName: requestedProjectName,
    uniqueProjectDirectoryName: uniqueProjectName,
  })

  return createNewProjectDirectory(
    uniqueProjectName,
    await wasmInstancePromise,
    undefined,
    undefined,
    undefined,
    projectDirectoryPath,
    uniqueProjectTitle
  )
}
