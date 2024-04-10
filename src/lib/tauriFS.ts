import {
  mkdir,
  exists,
  readTextFile,
  writeTextFile,
  stat,
} from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import {
  appConfigDir,
  documentDir,
  homeDir,
  join,
  sep,
} from '@tauri-apps/api/path'
import { isTauri } from './isTauri'
import type { FileEntry, ProjectWithEntryPointMetadata } from 'lib/types'
import {
  FILE_EXT,
  INDEX_IDENTIFIER,
  MAX_PADDING,
  PROJECT_ENTRYPOINT,
  PROJECT_FOLDER,
  RELEVANT_FILE_TYPES,
  SETTINGS_FILE_EXT,
} from 'lib/constants'
import { SaveSettingsPayload, SettingsLevel } from './settings/settingsTypes'
import * as TOML from '@iarna/toml'

type PathWithPossibleError = {
  path: string | null
  error: Error | null
}

export async function getInitialDefaultDir() {
  if (!isTauri()) return ''
  let dir
  try {
    dir = await documentDir()
  } catch (e) {
    dir = await join(await homeDir(), 'Documents') // for headless Linux (eg. Github Actions)
  }

  return await join(dir, PROJECT_FOLDER)
}

// Initializes the project directory and returns the path
// with any Errors that occurred
export async function initializeProjectDirectory(
  directory: string
): Promise<PathWithPossibleError> {
  let returnValue: PathWithPossibleError = {
    path: null,
    error: null,
  }

  if (!isTauri()) return returnValue

  if (directory) {
    returnValue = await testAndCreateDir(directory, returnValue)
  }

  // If the directory from settings does not exist or could not be created,
  // use the default directory
  if (returnValue.path === null) {
    const INITIAL_DEFAULT_DIR = await getInitialDefaultDir()
    const defaultReturnValue = await testAndCreateDir(
      INITIAL_DEFAULT_DIR,
      returnValue,
      {
        exists: 'Error checking default directory.',
        create: 'Error creating default directory.',
      }
    )
    returnValue.path = defaultReturnValue.path
    returnValue.error =
      returnValue.error === null ? defaultReturnValue.error : returnValue.error
  }

  return returnValue
}

async function testAndCreateDir(
  directory: string,
  returnValue = {
    path: null,
    error: null,
  } as PathWithPossibleError,
  errorMessages = {
    exists:
      'Error checking directory at path from saved settings. Using default.',
    create:
      'Error creating directory at path from saved settings. Using default.',
  }
): Promise<PathWithPossibleError> {
  const dirExists = await exists(directory).catch((e) => {
    console.error(`Error checking directory ${directory}. Original error:`, e)
    return new Error(errorMessages.exists)
  })

  if (dirExists instanceof Error) {
    returnValue.error = dirExists
  } else if (dirExists === false) {
    const newDirCreated = await mkdir(directory, { recursive: true }).catch(
      (e) => {
        console.error(
          `Error creating directory ${directory}. Original error:`,
          e
        )
        return new Error(errorMessages.create)
      }
    )

    if (newDirCreated instanceof Error) {
      returnValue.error = newDirCreated
    } else {
      returnValue.path = directory
    }
  } else if (dirExists === true) {
    returnValue.path = directory
  }

  return returnValue
}

export function isProjectDirectory(fileOrDir: Partial<FileEntry>) {
  return (
    fileOrDir.children?.length &&
    fileOrDir.children.some((child) => child.name === PROJECT_ENTRYPOINT)
  )
}

// Read the contents of a directory
// and return the valid projects
export async function getProjectsInDir(projectDir: string) {
  const readProjects = (
    await invoke<FileEntry[]>('read_dir_recursive', { path: projectDir })
  ).filter(isProjectDirectory)

  const projectsWithMetadata = await Promise.all(
    readProjects.map(async (p) => ({
      entrypointMetadata: await stat(await join(p.path, PROJECT_ENTRYPOINT)),
      ...p,
    }))
  )

  return projectsWithMetadata
}

export const isHidden = (fileOrDir: FileEntry) =>
  !!fileOrDir.name?.startsWith('.')

export const isDir = (fileOrDir: FileEntry) =>
  'children' in fileOrDir && fileOrDir.children !== undefined

export function deepFileFilter(
  entries: FileEntry[],
  filterFn: (f: FileEntry) => boolean
): FileEntry[] {
  const filteredEntries: FileEntry[] = []
  for (const fileOrDir of entries) {
    if ('children' in fileOrDir && fileOrDir.children !== undefined) {
      const filteredChildren = deepFileFilter(fileOrDir.children, filterFn)
      if (filterFn(fileOrDir)) {
        filteredEntries.push({
          ...fileOrDir,
          children: filteredChildren,
        })
      }
    } else if (filterFn(fileOrDir)) {
      filteredEntries.push(fileOrDir)
    }
  }
  return filteredEntries
}

export function deepFileFilterFlat(
  entries: FileEntry[],
  filterFn: (f: FileEntry) => boolean
): FileEntry[] {
  const filteredEntries: FileEntry[] = []
  for (const fileOrDir of entries) {
    if ('children' in fileOrDir && fileOrDir.children !== undefined) {
      const filteredChildren = deepFileFilterFlat(fileOrDir.children, filterFn)
      if (filterFn(fileOrDir)) {
        filteredEntries.push({
          ...fileOrDir,
          children: filteredChildren,
        })
      }
      filteredEntries.push(...filteredChildren)
    } else if (filterFn(fileOrDir)) {
      filteredEntries.push(fileOrDir)
    }
  }
  return filteredEntries
}

// Read the contents of a project directory
// and return all relevant files and sub-directories recursively
export async function readProject(projectDir: string) {
  const readFiles = await invoke<FileEntry[]>('read_dir_recursive', {
    path: projectDir,
  })

  return deepFileFilter(readFiles, isRelevantFileOrDir)
}

// Given a read project, return the number of .kcl files,
// both in the root directory and in sub-directories,
// and folders that contain at least one .kcl file
export function getPartsCount(project: FileEntry[]) {
  const flatProject = deepFileFilterFlat(project, isRelevantFileOrDir)

  const kclFileCount = flatProject.filter((f) =>
    f.name?.endsWith(FILE_EXT)
  ).length
  const kclDirCount = flatProject.filter((f) => f.children !== undefined).length

  return {
    kclFileCount,
    kclDirCount,
  }
}

// Determines if a file or directory is relevant to the project
// i.e. not a hidden file or directory, and is a relevant file type
// or contains at least one relevant file (even if it's nested)
// or is a completely empty directory
export function isRelevantFileOrDir(fileOrDir: FileEntry) {
  let isRelevantDir = false
  if ('children' in fileOrDir && fileOrDir.children !== undefined) {
    isRelevantDir =
      !isHidden(fileOrDir) &&
      (fileOrDir.children.some(isRelevantFileOrDir) ||
        fileOrDir.children.length === 0)
  }
  const isRelevantFile =
    !isHidden(fileOrDir) &&
    RELEVANT_FILE_TYPES.some((ext) => fileOrDir.name?.endsWith(ext))

  return (
    (isDir(fileOrDir) && isRelevantDir) || (!isDir(fileOrDir) && isRelevantFile)
  )
}

// Deeply sort the files and directories in a project like VS Code does:
// The main.kcl file is always first, then files, then directories
// Files and directories are sorted alphabetically
export function sortProject(project: FileEntry[]): FileEntry[] {
  const sortedProject = project.sort((a, b) => {
    if (a.name === PROJECT_ENTRYPOINT) {
      return -1
    } else if (b.name === PROJECT_ENTRYPOINT) {
      return 1
    } else if (a.children === undefined && b.children !== undefined) {
      return -1
    } else if (a.children !== undefined && b.children === undefined) {
      return 1
    } else if (a.name && b.name) {
      return a.name.localeCompare(b.name)
    } else {
      return 0
    }
  })

  return sortedProject.map((fileOrDir: FileEntry) => {
    if ('children' in fileOrDir && fileOrDir.children !== undefined) {
      return {
        ...fileOrDir,
        children: sortProject(fileOrDir.children),
      }
    } else {
      return fileOrDir
    }
  })
}

// Creates a new file in the default directory with the default project name
// Returns the path to the new file
export async function createNewProject(
  path: string,
  initCode = ''
): Promise<ProjectWithEntryPointMetadata> {
  if (!isTauri) {
    throw new Error('createNewProject() can only be called from a Tauri app')
  }

  const dirExists = await exists(path)
  if (!dirExists) {
    await mkdir(path, { recursive: true }).catch((err) => {
      console.error('Error creating new directory:', err)
      throw err
    })
  }

  await writeTextFile(await join(path, PROJECT_ENTRYPOINT), initCode).catch(
    (err) => {
      console.error('Error creating new file:', err)
      throw err
    }
  )

  const m = await stat(path)

  return {
    name: path.slice(path.lastIndexOf(sep()) + 1),
    path: path,
    entrypointMetadata: m,
    children: [
      {
        name: PROJECT_ENTRYPOINT,
        path: await join(path, PROJECT_ENTRYPOINT),
        children: [],
      },
    ],
  }
}

// create a regex to match the project name
// replacing any instances of "$n" with a regex to match any number
function interpolateProjectName(projectName: string) {
  const regex = new RegExp(
    projectName.replace(getPaddedIdentifierRegExp(), '([0-9]+)')
  )
  return regex
}

// Returns the next available index for a project name
export function getNextProjectIndex(projectName: string, files: FileEntry[]) {
  const regex = interpolateProjectName(projectName)
  const matches = files.map((file) => file.name?.match(regex))
  const indices = matches
    .filter(Boolean)
    .map((match) => match![1])
    .map(Number)
  const maxIndex = Math.max(...indices, -1)
  return maxIndex + 1
}

// Interpolates the project name with the next available index,
// padding the index with 0s if necessary
export function interpolateProjectNameWithIndex(
  projectName: string,
  index: number
) {
  const regex = getPaddedIdentifierRegExp()

  const matches = projectName.match(regex)
  const padStartLength = Math.min(
    matches !== null ? matches[1]?.length || 0 : 0,
    MAX_PADDING
  )
  return projectName.replace(
    regex,
    index.toString().padStart(padStartLength + 1, '0')
  )
}

export function doesProjectNameNeedInterpolated(projectName: string) {
  return projectName.includes(INDEX_IDENTIFIER)
}

function escapeRegExpChars(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getPaddedIdentifierRegExp() {
  const escapedIdentifier = escapeRegExpChars(INDEX_IDENTIFIER)
  return new RegExp(`${escapedIdentifier}(${escapedIdentifier.slice(-1)}*)`)
}

export async function getUserSettingsFilePath(
  filename: string = SETTINGS_FILE_EXT
) {
  const dir = await appConfigDir()
  return await join(dir, filename)
}

export async function readSettingsFile(
  path: string
): Promise<Partial<SaveSettingsPayload>> {
  const dir = path.slice(0, path.lastIndexOf(sep()))

  const dirExists = await exists(dir)
  if (!dirExists) {
    await mkdir(dir, { recursive: true })
  }

  const settingsExist = dirExists ? await exists(path) : false

  if (!settingsExist) {
    console.log(`Settings file does not exist at ${path}`)
    return {}
  }

  try {
    const settings = await readTextFile(path)
    // We expect the settings to be under a top-level [settings] key
    return TOML.parse(settings).settings as Partial<SaveSettingsPayload>
  } catch (e) {
    console.error('Error reading settings file:', e)
    return {}
  }
}

export async function getSettingsFilePaths(
  projectPath?: string
): Promise<Partial<Record<SettingsLevel, string>>> {
  const { user, project } = await getSettingsFolderPaths(projectPath)

  return {
    user: user + 'user' + SETTINGS_FILE_EXT,
    project:
      project !== undefined
        ? project + (isTauri() ? sep : '/') + 'project' + SETTINGS_FILE_EXT
        : undefined,
  }
}

export async function getSettingsFolderPaths(projectPath?: string) {
  const user = isTauri() ? await appConfigDir() : '/'
  const project = projectPath !== undefined ? projectPath : undefined

  return {
    user,
    project,
  }
}
