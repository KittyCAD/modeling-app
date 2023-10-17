import {
  FileEntry,
  createDir,
  exists,
  readDir,
  writeTextFile,
} from '@tauri-apps/api/fs'
import { documentDir, homeDir, sep } from '@tauri-apps/api/path'
import { isTauri } from './isTauri'
import { ProjectWithEntryPointMetadata } from '../Router'
import { metadata } from 'tauri-plugin-fs-extra-api'
import { bracket } from './exampleKcl'

const PROJECT_FOLDER = 'kittycad-modeling-projects'
export const FILE_EXT = '.kcl'
export const PROJECT_ENTRYPOINT = 'main' + FILE_EXT
const INDEX_IDENTIFIER = '$n' // $nn.. will pad the number with 0s
export const MAX_PADDING = 7
const RELEVANT_FILE_TYPES = ['kcl']

// Initializes the project directory and returns the path
export async function initializeProjectDirectory(directory: string) {
  if (!isTauri()) {
    throw new Error(
      'initializeProjectDirectory() can only be called from a Tauri app'
    )
  }

  if (directory) {
    const dirExists = await exists(directory)
    if (!dirExists) {
      await createDir(directory, { recursive: true })
    }
    return directory
  }

  let docDirectory: string
  try {
    docDirectory = await documentDir()
  } catch (e) {
    console.log('error', e)
    docDirectory = await homeDir() // seems to work better on Linux
  }

  const INITIAL_DEFAULT_DIR = docDirectory + PROJECT_FOLDER

  const defaultDirExists = await exists(INITIAL_DEFAULT_DIR)

  if (!defaultDirExists) {
    await createDir(INITIAL_DEFAULT_DIR, { recursive: true })
  }

  return INITIAL_DEFAULT_DIR
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
    await readDir(projectDir, {
      recursive: true,
    })
  ).filter(isProjectDirectory)

  const projectsWithMetadata = await Promise.all(
    readProjects.map(async (p) => ({
      entrypointMetadata: await metadata(p.path + sep + PROJECT_ENTRYPOINT),
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
  const readFiles = await readDir(projectDir, {
    recursive: true,
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
  path: string
): Promise<ProjectWithEntryPointMetadata> {
  if (!isTauri) {
    throw new Error('createNewProject() can only be called from a Tauri app')
  }

  const dirExists = await exists(path)
  if (!dirExists) {
    await createDir(path, { recursive: true }).catch((err) => {
      console.error('Error creating new directory:', err)
      throw err
    })
  }

  await writeTextFile(path + sep + PROJECT_ENTRYPOINT, bracket).catch((err) => {
    console.error('Error creating new file:', err)
    throw err
  })

  const m = await metadata(path)

  return {
    name: path.slice(path.lastIndexOf(sep) + 1),
    path: path,
    entrypointMetadata: m,
    children: [
      {
        name: PROJECT_ENTRYPOINT,
        path: path + sep + PROJECT_ENTRYPOINT,
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
