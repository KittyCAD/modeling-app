import { writeFileWithParents } from '@src/lib/fileSystem/writeFile'
import { createStagedProject } from '@src/lib/fileSystem/createStagedProject'
import { getRelativePathIfContained } from '@src/lib/paths'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import {
  getProjectDirectoryNameFromTitle,
  getUniqueProjectNameFromExistingNames,
} from '@src/lib/projectName'
import { getProjectTomlContents } from '@src/lib/projectToml'
import { prepareProjectTomlForDuplication } from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import * as uuid from 'uuid'

type DuplicateProjectSource = {
  directoryName: string
  displayName: string
  path: string
}

export type DuplicateProjectResult = {
  message: string
  name: string
  title: string
}

function getProjectRelativeCurrentFilePath({
  sourcePath,
  currentFilePath,
}: {
  sourcePath: string
  currentFilePath?: string | null
}) {
  if (!currentFilePath) {
    return undefined
  }

  const relativeCurrentFilePath = getRelativePathIfContained(
    sourcePath,
    currentFilePath
  )
  if (
    !relativeCurrentFilePath ||
    relativeCurrentFilePath === PROJECT_SETTINGS_FILE_NAME
  ) {
    return undefined
  }

  return relativeCurrentFilePath
}

async function writeProjectRelativeFile(
  fileOperations: FileOperationsRegistryService,
  projectPath: string,
  relativePath: string,
  contents: string
) {
  const filePath = fsZds.join(projectPath, relativePath)

  await writeFileWithParents(fileOperations, filePath, contents)
}

export async function duplicateProjectInDirectory({
  fileOperations,
  source,
  projectDirectoryPath,
  requestedProjectTitle,
  currentFilePath,
  currentFileContents,
  wasmInstance,
}: {
  fileOperations: FileOperationsRegistryService
  source: DuplicateProjectSource
  projectDirectoryPath: string
  requestedProjectTitle: string
  currentFilePath?: string | null
  currentFileContents?: string
  wasmInstance: ModuleType
}): Promise<DuplicateProjectResult> {
  const projectTitle = requestedProjectTitle.trim() || source.displayName
  const requestedCopyTitle = `${projectTitle}-copy`
  const requestedCopyName = getProjectDirectoryNameFromTitle(
    requestedCopyTitle,
    `${source.directoryName}-copy`
  )
  const name = getUniqueProjectNameFromExistingNames(
    requestedCopyName,
    await fileOperations.readDirectory(projectDirectoryPath)
  )
  const title = `${requestedCopyTitle}${name.slice(requestedCopyName.length)}`

  const projectToml = await getProjectTomlContents({
    fileOperations,
    projectPath: source.path,
    wasmInstance,
  })
  if (isErr(projectToml)) {
    return Promise.reject(projectToml)
  }
  const duplicatedProjectToml = prepareProjectTomlForDuplication(
    projectToml,
    title,
    uuid.v4()
  )
  if (isErr(duplicatedProjectToml)) {
    return Promise.reject(duplicatedProjectToml)
  }

  const targetPath = fsZds.join(projectDirectoryPath, name)
  const relativeCurrentFilePath = getProjectRelativeCurrentFilePath({
    sourcePath: source.path,
    currentFilePath,
  })
  await createStagedProject(
    fileOperations,
    targetPath,
    async (temporaryPath) => {
      await fileOperations.copy(source.path, temporaryPath)
      // Overlay the editor snapshot on the copy without bypassing source-file
      // conflict detection or racing its pending autosave.
      if (relativeCurrentFilePath && currentFileContents !== undefined) {
        await writeProjectRelativeFile(
          fileOperations,
          temporaryPath,
          relativeCurrentFilePath,
          currentFileContents
        )
      }

      await fileOperations.writeFile(
        fsZds.join(temporaryPath, PROJECT_SETTINGS_FILE_NAME),
        duplicatedProjectToml
      )
    }
  )

  return {
    message: `Successfully duplicated "${source.displayName}" as "${title}"`,
    name,
    title,
  }
}
