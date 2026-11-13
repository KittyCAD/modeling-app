import { relevantFileExtensions } from '@src/lang/wasmUtils'
import { FILE_EXT } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import {
  getEXTWithPeriod,
  getVersionedCreoExtensionWithPeriod,
  isExtensionARelevantExtension,
} from '@src/lib/paths'
import type { FileEntry } from '@src/lib/project'
import {
  getNextProjectIndexFromNames,
  getUniqueProjectNameFromNames,
} from '@src/lib/projectName'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

export {
  doesProjectNameNeedInterpolated,
  getUniqueProjectNameFromNames,
  interpolateProjectNameWithIndex,
} from '@src/lib/projectName'

export const isHidden = (fileOrDir: FileEntry) =>
  !!fileOrDir.name?.startsWith('.')

export const isDir = (fileOrDir: FileEntry) =>
  'children' in fileOrDir && fileOrDir.children !== undefined

// Shallow sort the files and directories
// Files and directories are sorted alphabetically
export function sortFilesAndDirectories(files: FileEntry[]): FileEntry[] {
  return files.sort((a, b) => {
    if (a.children === null && b.children !== null) {
      return 1
    } else if (a.children !== null && b.children === null) {
      return -1
    } else if (a.name && b.name) {
      return a.name.localeCompare(b.name)
    } else {
      return 0
    }
  })
}

// Returns the next available index for a project name
export function getNextProjectIndex(
  projectName: string,
  projects: FileEntry[]
) {
  return getNextProjectIndexFromNames(
    projectName,
    projects.map((project) => project.name)
  )
}

/** Return an available project name, including index interpolation. */
export function getUniqueProjectName(name: string, projects: FileEntry[]) {
  return getUniqueProjectNameFromNames(
    name,
    projects.map((project) => project.name)
  )
}

export async function getSettingsFolderPaths(projectPath?: string) {
  const user = await fsZds.getPath('appData')
  const project = projectPath !== undefined ? projectPath : undefined

  return {
    user,
    project,
  }
}

/**
 * Get the next available file name by appending a hyphen and number to the end of the name
 */
export async function getNextFileName({
  fileOperations,
  entryName,
  baseDir,
  wasmInstance,
  preserveUnknownExtension = false,
}: {
  fileOperations: FileOperationsRegistryService
  entryName: string
  baseDir: string
  wasmInstance: ModuleType
  preserveUnknownExtension?: boolean
}) {
  const extensions = relevantFileExtensions(wasmInstance)
  const isRelevantFile = isExtensionARelevantExtension(entryName, extensions)

  // Do the following business logic with the period in the extension
  let extension =
    getVersionedCreoExtensionWithPeriod(entryName) ||
    getEXTWithPeriod(entryName)
  if (!preserveUnknownExtension && (!isRelevantFile || !extension)) {
    extension = FILE_EXT
  }
  extension ??= ''

  // Remove any existing index from the name before adding a new one
  let createdName = entryName.replace(extension, '') + extension
  let createdPath = fsZds.join(baseDir, createdName)
  let i = 1
  try {
    while (await fileOperations.exists(createdPath)) {
      const matchOnIndexAndExtension = new RegExp(`(-\\d+)?(${extension})?$`)
      createdName =
        entryName.replace(matchOnIndexAndExtension, '') + `-${i}` + extension
      createdPath = fsZds.join(baseDir, createdName)
      i++
    }
  } catch (e) {
    // I (lee) know, the behavior is weird. It's because `stat` is the way to
    // check for file existence, and on throw, it will escape this loop, which
    // I did not originally write - this code used the synchronous, deprecated
    // `exists` method.
    console.error(e)
  }

  return {
    name: createdName,
    path: createdPath,
  }
}

/**
 * Get the next available directory name by appending a hyphen and number to the end of the name
 */
export async function getNextDirName({
  fileOperations,
  entryName,
  baseDir,
}: {
  fileOperations: FileOperationsRegistryService
  entryName: string
  baseDir: string
}) {
  let createdName = entryName
  let createdPath = fsZds.join(baseDir, createdName)
  let i = 1

  while (await fileOperations.exists(createdPath)) {
    createdName = entryName.replace(/-\d+$/, '') + `-${i}`
    createdPath = fsZds.join(baseDir, createdName)
    i++
  }
  return {
    name: createdName,
    path: createdPath,
  }
}
