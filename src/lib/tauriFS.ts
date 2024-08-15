import { appConfigDir, join } from '@tauri-apps/api/path'
import { isTauri } from './isTauri'
import type { FileEntry } from 'lib/types'
import {
  FILE_EXT,
  INDEX_IDENTIFIER,
  MAX_PADDING,
  ONBOARDING_PROJECT_NAME,
  PROJECT_ENTRYPOINT,
} from 'lib/constants'
import { bracket } from './exampleKcl'
import { PATHS } from './paths'
import {
  createNewProjectDirectory,
  listProjects,
  readAppSettingsFile,
} from './tauri'
import { engineCommandManager } from './singletons'
import { exists } from '@tauri-apps/plugin-fs'

export const isHidden = (fileOrDir: FileEntry) =>
  !!fileOrDir.name?.startsWith('.')

export const isDir = (fileOrDir: FileEntry) =>
  'children' in fileOrDir && fileOrDir.children !== undefined

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
        children: sortProject(fileOrDir.children || []),
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

export async function createAndOpenNewProject({
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
  // Clear the scene and end the session.
  engineCommandManager.endSession()

  // Create a new project with the onboarding project name
  const configuration = await readAppSettingsFile()
  const projects = await listProjects(configuration)
  const nextIndex = getNextProjectIndex(ONBOARDING_PROJECT_NAME, projects)
  const name = interpolateProjectNameWithIndex(
    ONBOARDING_PROJECT_NAME,
    nextIndex
  )
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
 * @todo move this to the equivalent of tauriFS.ts for Electron migration
 */
export async function getNextFileName({
  entryName,
  baseDir,
}: {
  entryName: string
  baseDir: string
}) {
  // Remove any existing index from the name before adding a new one
  let createdName = entryName.replace(FILE_EXT, '') + FILE_EXT
  let createdPath = await join(baseDir, createdName)
  let i = 1
  while (await exists(createdPath)) {
    const matchOnIndexAndExtension = new RegExp(`(-\\d+)?(${FILE_EXT})?$`)
    createdName =
      entryName.replace(matchOnIndexAndExtension, '') + `-${i}` + FILE_EXT
    createdPath = await join(baseDir, createdName)
    i++
  }
  return {
    name: createdName,
    path: createdPath,
  }
}

/**
 * Get the next available directory name by appending a hyphen and number to the end of the name
 * @todo move this to the equivalent of tauriFS.ts for Electron migration
 */
export async function getNextDirName({
  entryName,
  baseDir,
}: {
  entryName: string
  baseDir: string
}) {
  let createdName = entryName
  let createdPath = await join(baseDir, createdName)
  let i = 1
  while (await exists(createdPath)) {
    createdName = entryName.replace(/-\d+$/, '') + `-${i}`
    createdPath = await join(baseDir, createdName)
    i++
  }
  return {
    name: createdName,
    path: createdPath,
  }
}
