import { appConfigDir } from '@tauri-apps/api/path'
import { isTauri } from './isTauri'
import type { FileEntry } from 'lib/types'
import {
  FILE_EXT,
  INDEX_IDENTIFIER,
  MAX_PADDING,
  ONBOARDING_PROJECT_NAME,
  PROJECT_ENTRYPOINT,
  RELEVANT_FILE_TYPES,
} from 'lib/constants'
import { bracket } from './exampleKcl'
import { paths } from './paths'
import {
  createNewProjectDirectory,
  listProjects,
  readAppSettingsFile,
  readDirRecursive,
} from './tauri'

export function isProjectDirectory(fileOrDir: Partial<FileEntry>) {
  return (
    fileOrDir.children?.length &&
    fileOrDir.children.some((child) => child.name === PROJECT_ENTRYPOINT)
  )
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
  const readFiles = await readDirRecursive(projectDir)

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

export async function getSettingsFolderPaths(projectPath?: string) {
  const user = isTauri() ? await appConfigDir() : '/'
  const project = projectPath !== undefined ? projectPath : undefined

  return {
    user,
    project,
  }
}

export async function createAndOpenNewProject(
  navigate: (path: string) => void
) {
  const configuration = await readAppSettingsFile()
  const projects = await listProjects(configuration)
  const nextIndex = getNextProjectIndex(ONBOARDING_PROJECT_NAME, projects)
  const name = interpolateProjectNameWithIndex(
    ONBOARDING_PROJECT_NAME,
    nextIndex
  )
  const newFile = await createNewProjectDirectory(name, bracket, configuration)
  navigate(`${paths.FILE}/${encodeURIComponent(newFile.path)}`)
}
