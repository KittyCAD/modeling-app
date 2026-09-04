import {
  DUPLICATE_PROJECT_TEMPORARY_PREFIX,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import {
  createNewProjectDirectory,
  getProjectInfo,
  isPathNotFoundError,
} from '@src/lib/desktop'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import type { ProjectLibraryInitialProject } from '@src/lib/projectLibraries'
import { getProjectTitleFromUniqueDirectoryName } from '@src/lib/projectName'
import {
  prepareProjectTomlForDuplication,
  setProjectDefaultFileInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { v4 } from 'uuid'

export interface MoveProjectIntoLocalDirectoryResult {
  localProjectPath: string
  defaultFile?: string
}

async function getProjectDirectoryEntryNames(
  fileOperations: FileOperationsRegistryService,
  projectDirectoryPath: string
) {
  try {
    return (await fileOperations.readDirectory(projectDirectoryPath)).map(
      ({ name }) => name
    )
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
  fileOperations: FileOperationsRegistryService,
  temporaryProjectPath: string,
  error: unknown
): Promise<never> {
  await fileOperations.remove(temporaryProjectPath).catch(() => undefined)
  return Promise.reject(error)
}

export async function createProjectInLocalDirectory({
  fileOperations,
  projectDirectoryPath,
  requestedProjectName,
  requestedProjectTitle,
  wasmInstancePromise,
  initialKclFile,
  initialProject,
}: {
  fileOperations: FileOperationsRegistryService
  projectDirectoryPath: string
  requestedProjectName: string
  requestedProjectTitle: string
  wasmInstancePromise: Promise<ModuleType> | ModuleType
  initialKclFile?: {
    fileName: string
    code: string
  }
  initialProject?: ProjectLibraryInitialProject
}): Promise<Project> {
  const existingProjectNames = await getProjectDirectoryEntryNames(
    fileOperations,
    projectDirectoryPath
  )
  const uniqueProjectName = getUniqueProjectName(
    requestedProjectName,
    projectEntriesFromNames(projectDirectoryPath, existingProjectNames)
  )
  const uniqueProjectTitle = getProjectTitleFromUniqueDirectoryName({
    requestedProjectTitle,
    requestedProjectDirectoryName: requestedProjectName,
    uniqueProjectDirectoryName: uniqueProjectName,
  })

  if (initialProject) {
    return createProjectFromFilesInLocalDirectory({
      fileOperations,
      projectDirectoryPath,
      requestedProjectName,
      projectName: uniqueProjectName,
      projectTitle: uniqueProjectTitle,
      initialProject,
      wasmInstancePromise,
    })
  }

  return createNewProjectDirectory(
    fileOperations,
    uniqueProjectName,
    await wasmInstancePromise,
    initialKclFile?.code,
    undefined,
    initialKclFile?.fileName,
    projectDirectoryPath,
    uniqueProjectTitle
  )
}

async function createProjectFromFilesInLocalDirectory({
  fileOperations,
  projectDirectoryPath,
  requestedProjectName,
  projectName,
  projectTitle,
  initialProject,
  wasmInstancePromise,
}: {
  fileOperations: FileOperationsRegistryService
  projectDirectoryPath: string
  requestedProjectName: string
  projectName: string
  projectTitle: string
  initialProject: ProjectLibraryInitialProject
  wasmInstancePromise: Promise<ModuleType> | ModuleType
}): Promise<Project> {
  const temporaryProjectPath = fsZds.join(
    projectDirectoryPath,
    `${DUPLICATE_PROJECT_TEMPORARY_PREFIX}${v4()}`
  )
  const projectPath = fsZds.join(projectDirectoryPath, projectName)
  const relativeProjectPath = fsZds.relative(
    fsZds.resolve(projectDirectoryPath),
    fsZds.resolve(projectPath)
  )
  if (
    !relativeProjectPath ||
    relativeProjectPath === '..' ||
    relativeProjectPath.startsWith(`..${fsZds.sep}`) ||
    relativeProjectPath.includes(fsZds.sep) ||
    relativeProjectPath === fsZds.resolve(relativeProjectPath)
  ) {
    return Promise.reject(
      new Error(
        `The shared project contained an invalid project directory name: "${requestedProjectName}".`
      )
    )
  }

  await fileOperations.createDirectory(temporaryProjectPath)
  try {
    for (const file of initialProject.files) {
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
          fileOperations,
          temporaryProjectPath,
          new Error(
            `The shared project contained an invalid file path: "${file.requestedFileName}".`
          )
        )
      }

      await fileOperations.writeFile(targetPath, file.requestedData)
    }

    const sourceProjectToml = initialProject.files.find(
      (file) => file.requestedFileName === PROJECT_SETTINGS_FILE_NAME
    )
    const projectTomlWithEntrypoint =
      setProjectDefaultFileInProjectTomlContents(
        sourceProjectToml
          ? new TextDecoder().decode(sourceProjectToml.requestedData)
          : '',
        initialProject.entrypointFilePath
      )
    const projectToml = prepareProjectTomlForDuplication(
      projectTomlWithEntrypoint,
      projectTitle,
      v4()
    )
    if (isErr(projectToml)) {
      return rejectProjectImport(
        fileOperations,
        temporaryProjectPath,
        projectToml
      )
    }
    await fileOperations.writeFile(
      fsZds.join(temporaryProjectPath, PROJECT_SETTINGS_FILE_NAME),
      new TextEncoder().encode(projectToml)
    )
    await fileOperations.rename(temporaryProjectPath, projectPath)
  } catch (error) {
    return rejectProjectImport(fileOperations, temporaryProjectPath, error)
  }

  return getProjectInfo(fileOperations, projectPath, await wasmInstancePromise)
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
  fileOperations,
  sourceProjectPath,
  targetProjectPath,
}: {
  fileOperations: FileOperationsRegistryService
  sourceProjectPath: string
  targetProjectPath: string
}) {
  await fileOperations.move(sourceProjectPath, targetProjectPath)
}

export async function moveProjectIntoLocalDirectory({
  fileOperations,
  projectDirectoryPath,
  sourceProjectPath,
  sourceProjectName,
  defaultFile,
}: {
  fileOperations: FileOperationsRegistryService
  projectDirectoryPath: string
  sourceProjectPath: string
  sourceProjectName: string
  defaultFile?: string
}): Promise<MoveProjectIntoLocalDirectoryResult> {
  const existingProjectNames = await getProjectDirectoryEntryNames(
    fileOperations,
    projectDirectoryPath
  )
  const targetProjectName = getUniqueProjectName(
    sourceProjectName,
    projectEntriesFromNames(projectDirectoryPath, existingProjectNames)
  )
  const targetProjectPath = fsZds.join(projectDirectoryPath, targetProjectName)

  await moveProjectDirectory({
    fileOperations,
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
