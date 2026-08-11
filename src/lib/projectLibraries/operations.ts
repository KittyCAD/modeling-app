import {
  createNewProjectDirectory,
  isPathNotFoundError,
} from '@src/lib/desktop'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import { getProjectTitleFromUniqueDirectoryName } from '@src/lib/projectName'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export interface MoveProjectIntoLocalDirectoryResult {
  localProjectPath: string
  defaultFile?: string
}

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
  initialKclFile,
}: {
  projectDirectoryPath: string
  requestedProjectName: string
  requestedProjectTitle: string
  wasmInstancePromise: Promise<ModuleType> | ModuleType
  initialKclFile?: {
    fileName: string
    code: string
  }
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
    initialKclFile?.code,
    undefined,
    initialKclFile?.fileName,
    projectDirectoryPath,
    uniqueProjectTitle
  )
}

function getMovedDefaultFile({
  sourceProjectPath,
  targetProjectPath,
  defaultFile,
}: {
  sourceProjectPath: string
  targetProjectPath: string
  defaultFile?: string
}) {
  if (!defaultFile) {
    return undefined
  }

  const relativeDefaultFile = fsZds.relative(sourceProjectPath, defaultFile)
  if (
    !relativeDefaultFile ||
    relativeDefaultFile.startsWith('..') ||
    relativeDefaultFile === fsZds.resolve(relativeDefaultFile)
  ) {
    return undefined
  }

  return fsZds.join(targetProjectPath, relativeDefaultFile)
}

async function moveProjectDirectory({
  sourceProjectPath,
  targetProjectPath,
}: {
  sourceProjectPath: string
  targetProjectPath: string
}) {
  await fsZds.mkdir(fsZds.dirname(targetProjectPath), { recursive: true })

  try {
    await fsZds.rename(sourceProjectPath, targetProjectPath)
    return
  } catch {
    // Fall back to copy/remove for cases like cross-device moves.
  }

  await fsZds.cp(sourceProjectPath, targetProjectPath, {
    recursive: true,
    force: false,
  })
  await fsZds.rm(sourceProjectPath, { recursive: true })
}

export async function moveProjectIntoLocalDirectory({
  projectDirectoryPath,
  sourceProjectPath,
  sourceProjectName,
  defaultFile,
}: {
  projectDirectoryPath: string
  sourceProjectPath: string
  sourceProjectName: string
  defaultFile?: string
}): Promise<MoveProjectIntoLocalDirectoryResult> {
  const existingProjectNames =
    await getProjectDirectoryEntryNames(projectDirectoryPath)
  const targetProjectName = getUniqueProjectName(
    sourceProjectName,
    projectEntriesFromNames(projectDirectoryPath, existingProjectNames)
  )
  const targetProjectPath = fsZds.join(projectDirectoryPath, targetProjectName)

  await moveProjectDirectory({
    sourceProjectPath,
    targetProjectPath,
  })

  return {
    localProjectPath: targetProjectPath,
    defaultFile: getMovedDefaultFile({
      sourceProjectPath,
      targetProjectPath,
      defaultFile,
    }),
  }
}
