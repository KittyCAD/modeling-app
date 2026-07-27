import {
  DUPLICATE_PROJECT_TEMPORARY_PREFIX,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry } from '@src/lib/project'
import {
  getProjectDirectoryNameFromTitle,
  getProjectTitleFromUniqueDirectoryName,
} from '@src/lib/projectName'
import { getProjectTomlContents } from '@src/lib/projectToml'
import { prepareProjectTomlForDuplication } from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { v4 } from 'uuid'

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

export async function duplicateProjectInDirectory({
  source,
  projectDirectoryPath,
  requestedProjectTitle,
  wasmInstance,
}: {
  source: DuplicateProjectSource
  projectDirectoryPath: string
  requestedProjectTitle: string
  wasmInstance: ModuleType
}): Promise<DuplicateProjectResult> {
  const projectTitle = requestedProjectTitle.trim() || source.displayName
  const requestedProjectDirectoryName = getProjectDirectoryNameFromTitle(
    projectTitle,
    source.directoryName
  )
  const existingProjects: FileEntry[] = (
    await fsZds.readdir(projectDirectoryPath)
  ).map((name) => ({
    name,
    path: fsZds.join(projectDirectoryPath, name),
    children: [],
  }))
  const name = getUniqueProjectName(
    `${requestedProjectDirectoryName}-1`,
    existingProjects
  )
  const title = getProjectTitleFromUniqueDirectoryName({
    requestedProjectTitle: projectTitle,
    requestedProjectDirectoryName,
    uniqueProjectDirectoryName: name,
  })

  const projectToml = await getProjectTomlContents({
    projectPath: source.path,
    wasmInstance,
  })
  if (isErr(projectToml)) {
    return Promise.reject(projectToml)
  }
  const duplicatedProjectToml = prepareProjectTomlForDuplication(
    projectToml,
    title,
    v4()
  )
  if (isErr(duplicatedProjectToml)) {
    return Promise.reject(duplicatedProjectToml)
  }

  // Copy through a hidden temporary directory so cloud sync only sees the duplicate
  // after its project metadata no longer points at the source cloud project.
  const temporaryPath = fsZds.join(
    projectDirectoryPath,
    `${DUPLICATE_PROJECT_TEMPORARY_PREFIX}${v4()}`
  )
  const targetPath = fsZds.join(projectDirectoryPath, name)
  try {
    await fsZds.mkdir(temporaryPath)
    await fsZds.cp(source.path, temporaryPath, { recursive: true })
    await fsZds.writeFile(
      fsZds.join(temporaryPath, PROJECT_SETTINGS_FILE_NAME),
      new TextEncoder().encode(duplicatedProjectToml)
    )
    await fsZds.rename(temporaryPath, targetPath)
  } catch (error) {
    await fsZds.rm(temporaryPath, { recursive: true }).catch(() => undefined)
    return Promise.reject(error)
  }

  return {
    message: `Successfully duplicated "${source.displayName}" as "${title}"`,
    name,
    title,
  }
}
