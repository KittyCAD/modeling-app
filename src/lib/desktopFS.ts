import {
  FILE_EXT,
  INDEX_IDENTIFIER,
  MAX_PADDING,
  ONBOARDING_PROJECT_NAME,
} from '@src/lib/constants'
import {
  createNewProjectDirectory,
  listProjects,
  readAppSettingsFile,
} from '@src/lib/desktop'
import { bracket } from '@src/lib/exampleKcl'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import type { FileEntry } from '@src/lib/project'

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

// create a regex to match the project name
// replacing any instances of "$n" with a regex to match any number
function interpolateProjectName(projectName: string) {
  const regex = new RegExp(
    projectName.replace(getPaddedIdentifierRegExp(), '([0-9]+)')
  )
  return regex
}

// Returns the next available index for a project name
export function getNextProjectIndex(
  projectName: string,
  projects: FileEntry[]
) {
  const regex = interpolateProjectName(projectName)
  const matches = projects.map((project) => project.name?.match(regex))
  const indices = matches
    .filter(Boolean)
    .map((match) => (match !== null ? match[1] : '-1'))
    .map((maybeMatchIndex) => {
      return parseInt(maybeMatchIndex || '0', 10)
    })
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

/**
 * Given a target name, which may include our magic index interpolation string,
 * and a list of projects, return a unique name that doesn't conflict with any
 * of the existing projects, incrementing any ending number if necessary.
 * @param name
 * @param projects
 * @returns
 */
export function getUniqueProjectName(name: string, projects: FileEntry[]) {
  // The name may have our magic index interpolation string in it
  const needsInterpolation = doesProjectNameNeedInterpolated(name)

  if (needsInterpolation) {
    const nextIndex = getNextProjectIndex(name, projects)
    return interpolateProjectNameWithIndex(name, nextIndex)
  } else {
    let newName = name
    while (projects.some((project) => project.name === newName)) {
      const nameEndsWithNumber = newName.match(/\d+$/)
      newName = nameEndsWithNumber
        ? newName.replace(/\d+$/, (num) => `${parseInt(num, 10) + 1}`)
        : `${name}-1`
    }
    return newName
  }
}

function escapeRegExpChars(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getPaddedIdentifierRegExp() {
  const escapedIdentifier = escapeRegExpChars(INDEX_IDENTIFIER)
  return new RegExp(`${escapedIdentifier}(${escapedIdentifier.slice(-1)}*)`)
}

export async function getSettingsFolderPaths(projectPath?: string) {
  const user = isDesktop() ? await window.electron.getPath('appData') : '/'
  const project = projectPath !== undefined ? projectPath : undefined

  return {
    user,
    project,
  }
}

export async function createAndOpenNewTutorialProject({
  onProjectOpen,
  navigate,
}: {
  onProjectOpen: (
    project: {
      name: string | null
      path: string | null
    } | null,
    file: FileEntry | null
  ) => void
  navigate: (path: string) => void
}) {
  // Create a new project with the onboarding project name
  const configuration = await readAppSettingsFile()
  const projects = await listProjects(configuration)
  const nextIndex = getNextProjectIndex(ONBOARDING_PROJECT_NAME, projects)
  const name = interpolateProjectNameWithIndex(
    ONBOARDING_PROJECT_NAME,
    nextIndex
  )

  // Delete the tutorial project if it already exists.
  if (isDesktop()) {
    if (configuration.settings?.project?.directory === undefined) {
      return Promise.reject(new Error('configuration settings are undefined'))
    }

    const fullPath = window.electron.join(
      configuration.settings.project.directory,
      name
    )
    if (window.electron.exists(fullPath)) {
      await window.electron.rm(fullPath)
    }
  }

  const newProject = await createNewProjectDirectory(
    name,
    bracket,
    configuration
  )

  // Prep the LSP and navigate to the onboarding start
  onProjectOpen(
    {
      name: newProject.name,
      path: newProject.path,
    },
    null
  )
  navigate(
    `${PATHS.FILE}/${encodeURIComponent(newProject.default_file)}${
      PATHS.ONBOARDING.INDEX
    }`
  )
  return newProject
}

/**
 * Get the next available file name by appending a hyphen and number to the end of the name
 */
export function getNextFileName({
  entryName,
  baseDir,
}: {
  entryName: string
  baseDir: string
}) {
  // Remove any existing index from the name before adding a new one
  let createdName = entryName.replace(FILE_EXT, '') + FILE_EXT
  let createdPath = window.electron.path.join(baseDir, createdName)
  let i = 1
  while (window.electron.exists(createdPath)) {
    const matchOnIndexAndExtension = new RegExp(`(-\\d+)?(${FILE_EXT})?$`)
    createdName =
      entryName.replace(matchOnIndexAndExtension, '') + `-${i}` + FILE_EXT
    createdPath = window.electron.path.join(baseDir, createdName)
    i++
  }
  return {
    name: createdName,
    path: createdPath,
  }
}

/**
 * Get the next available directory name by appending a hyphen and number to the end of the name
 */
export function getNextDirName({
  entryName,
  baseDir,
}: {
  entryName: string
  baseDir: string
}) {
  let createdName = entryName
  let createdPath = window.electron.path.join(baseDir, createdName)
  let i = 1
  while (window.electron.exists(createdPath)) {
    createdName = entryName.replace(/-\d+$/, '') + `-${i}`
    createdPath = window.electron.path.join(baseDir, createdName)
    i++
  }
  return {
    name: createdName,
    path: createdPath,
  }
}
