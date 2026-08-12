import {
  createNewProjectDirectory,
  getProjectInfo,
  isPathNotFoundError,
} from '@src/lib/desktop'
import {
  DUPLICATE_PROJECT_TEMPORARY_PREFIX,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import { getProjectTitleFromUniqueDirectoryName } from '@src/lib/projectName'
import {
  prepareProjectTomlForDuplication,
  setProjectDefaultFileInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { v4 } from 'uuid'

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

async function rejectProjectImport(
  temporaryProjectPath: string,
  error: unknown
): Promise<never> {
  await fsZds
    .rm(temporaryProjectPath, { recursive: true })
    .catch(() => undefined)
  return Promise.reject(error)
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

export async function importProjectFilesIntoLocalDirectory({
  projectDirectoryPath,
  requestedProjectName,
  requestedProjectTitle,
  files,
  entrypointFilePath,
  wasmInstancePromise,
}: {
  projectDirectoryPath: string
  requestedProjectName: string
  requestedProjectTitle: string
  files: readonly {
    requestedFileName: string
    requestedData: Uint8Array<ArrayBuffer>
  }[]
  entrypointFilePath: string
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
  const temporaryProjectPath = fsZds.join(
    projectDirectoryPath,
    `${DUPLICATE_PROJECT_TEMPORARY_PREFIX}${v4()}`
  )
  const projectPath = fsZds.join(projectDirectoryPath, uniqueProjectName)

  await fsZds.mkdir(temporaryProjectPath, { recursive: true })
  try {
    for (const file of files) {
      if (file.requestedFileName === PROJECT_SETTINGS_FILE_NAME) {
        continue
      }

      const targetPath = fsZds.resolve(
        temporaryProjectPath,
        file.requestedFileName
      )
      const relativeTargetPath = fsZds.relative(
        temporaryProjectPath,
        targetPath
      )
      if (
        !relativeTargetPath ||
        relativeTargetPath === '..' ||
        relativeTargetPath.startsWith(`..${fsZds.sep}`) ||
        relativeTargetPath === fsZds.resolve(relativeTargetPath)
      ) {
        return rejectProjectImport(
          temporaryProjectPath,
          new Error(
            `The shared project contained an invalid file path: "${file.requestedFileName}".`
          )
        )
      }

      await fsZds.mkdir(fsZds.dirname(targetPath), { recursive: true })
      await fsZds.writeFile(targetPath, file.requestedData)
    }

    const sourceProjectToml = files.find(
      (file) => file.requestedFileName === PROJECT_SETTINGS_FILE_NAME
    )
    const projectTomlWithEntrypoint =
      setProjectDefaultFileInProjectTomlContents(
        sourceProjectToml
          ? new TextDecoder().decode(sourceProjectToml.requestedData)
          : '',
        entrypointFilePath
      )
    const projectToml = prepareProjectTomlForDuplication(
      projectTomlWithEntrypoint,
      uniqueProjectTitle,
      v4()
    )
    if (isErr(projectToml)) {
      return rejectProjectImport(temporaryProjectPath, projectToml)
    }
    await fsZds.writeFile(
      fsZds.join(temporaryProjectPath, PROJECT_SETTINGS_FILE_NAME),
      new TextEncoder().encode(projectToml)
    )
    await fsZds.rename(temporaryProjectPath, projectPath)
  } catch (error) {
    return rejectProjectImport(temporaryProjectPath, error)
  }

  return getProjectInfo(projectPath, await wasmInstancePromise)
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
