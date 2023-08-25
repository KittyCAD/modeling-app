import {
  FileEntry,
  createDir,
  exists,
  readDir,
  writeTextFile,
} from '@tauri-apps/api/fs'
import { documentDir } from '@tauri-apps/api/path'
import { isTauri } from './isTauri'
import { ProjectWithEntryPointMetadata } from '../Router'
import { metadata } from 'tauri-plugin-fs-extra-api'

const PROJECT_FOLDER = 'kittycad-modeling-projects'
export const FILE_EXT = '.kcl'
export const PROJECT_ENTRYPOINT = 'main' + FILE_EXT
const INDEX_IDENTIFIER = '$n' // $nn.. will pad the number with 0s
export const MAX_PADDING = 7

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

  const appData = await documentDir()

  const INITIAL_DEFAULT_DIR = appData + PROJECT_FOLDER

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
      entrypoint_metadata: await metadata(p.path + '/' + PROJECT_ENTRYPOINT),
      ...p,
    }))
  )

  return projectsWithMetadata
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

  await writeTextFile(path + '/' + PROJECT_ENTRYPOINT, '').catch((err) => {
    console.error('Error creating new file:', err)
    throw err
  })

  const m = await metadata(path)

  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path: path,
    entrypoint_metadata: m,
    children: [
      {
        name: PROJECT_ENTRYPOINT,
        path: path + '/' + PROJECT_ENTRYPOINT,
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
