import { createStagedProject } from '@src/lib/fileSystem/createStagedProject'
import { getRelativePathIfContained } from '@src/lib/paths'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import {
  createNewProjectDirectory,
  getProjectInfo,
  isPathNotFoundError,
} from '@src/lib/desktop'
import { collectProjectFilesForUpload } from '@src/lib/fileSystem/projectFiles'
import { ensureDirectory } from '@src/lib/fileSystem/ensureDirectory'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import type { ProjectLibraryInitialProject } from '@src/lib/projectLibraries'
import {
  getUniqueProjectNameFromNames,
  getProjectDirectoryNameFromTitle,
  getProjectTitleFromUniqueDirectoryName,
} from '@src/lib/projectName'
import {
  prepareProjectTomlForDuplication,
  setProjectDefaultFileInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { v4 } from 'uuid'

export interface CloneProjectIntoLocalDirectoryResult {
  localProjectPath: string
  defaultFile?: string
}

async function getProjectDirectoryEntryNames(
  fileOperations: FileOperationsRegistryService,
  projectDirectoryPath: string
) {
  try {
    return await fileOperations.readDirectory(projectDirectoryPath)
  } catch (error) {
    if (isPathNotFoundError(error)) {
      return []
    }
    return Promise.reject(error)
  }
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
  const uniqueProjectName = getUniqueProjectNameFromNames(
    requestedProjectName,
    existingProjectNames
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
  const projectPath = fsZds.join(projectDirectoryPath, projectName)
  const relativeProjectPath = getRelativePathIfContained(
    projectDirectoryPath,
    projectPath
  )
  if (!relativeProjectPath || relativeProjectPath.includes(fsZds.sep)) {
    return Promise.reject(
      new Error(
        `The shared project contained an invalid project directory name: "${requestedProjectName}".`
      )
    )
  }

  await createStagedProject(
    fileOperations,
    projectPath,
    async (temporaryProjectPath) => {
      for (const file of initialProject.files) {
        if (file.requestedFileName === PROJECT_SETTINGS_FILE_NAME) {
          continue
        }

        const targetPath = fsZds.resolve(
          temporaryProjectPath,
          file.requestedFileName
        )
        if (!getRelativePathIfContained(temporaryProjectPath, targetPath)) {
          return Promise.reject(
            new Error(
              `The shared project contained an invalid file path: "${file.requestedFileName}".`
            )
          )
        }

        await ensureDirectory(fileOperations, fsZds.dirname(targetPath))
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
        return Promise.reject(projectToml)
      }
      await fileOperations.writeFile(
        fsZds.join(temporaryProjectPath, PROJECT_SETTINGS_FILE_NAME),
        new TextEncoder().encode(projectToml)
      )
    }
  )

  return getProjectInfo(fileOperations, projectPath, await wasmInstancePromise)
}

/** Capture project files before creating an independent destination project. */
export async function cloneProjectIntoLocalDirectory({
  fileOperations,
  projectDirectoryPath,
  sourceProjectPath,
  sourceProjectName,
  defaultFile,
  requestedProjectTitle = sourceProjectName,
  wasmInstancePromise,
}: {
  fileOperations: FileOperationsRegistryService
  projectDirectoryPath: string
  sourceProjectPath: string
  sourceProjectName: string
  defaultFile?: string
  requestedProjectTitle?: string
  wasmInstancePromise: Promise<ModuleType> | ModuleType
}): Promise<CloneProjectIntoLocalDirectoryResult> {
  if (
    getRelativePathIfContained(sourceProjectPath, projectDirectoryPath) !==
    undefined
  )
    return Promise.reject(
      new Error('The clone destination must be outside the source project.')
    )
  const entrypoint = defaultFile
    ? getRelativePathIfContained(sourceProjectPath, defaultFile)?.replaceAll(
        '\\',
        '/'
      )
    : 'main.kcl'
  if (!entrypoint)
    return Promise.reject(
      new Error('The project entrypoint must be inside the source project.')
    )
  const files = await collectProjectFilesForUpload({
    fileOperations,
    projectRoot: sourceProjectPath,
  })
  const project = await createProjectInLocalDirectory({
    fileOperations,
    projectDirectoryPath,
    requestedProjectName: getProjectDirectoryNameFromTitle(
      sourceProjectName,
      'untitled'
    ),
    requestedProjectTitle,
    wasmInstancePromise,
    initialProject: {
      files: files.map((file) => ({
        requestedFileName: file.relativePath,
        requestedData: Uint8Array.from(file.data),
      })),
      entrypointFilePath: entrypoint,
    },
  })
  return { localProjectPath: project.path, defaultFile: project.default_file }
}
