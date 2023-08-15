import { FileEntry, createDir, exists, writeTextFile } from '@tauri-apps/api/fs'
import { appDataDir } from '@tauri-apps/api/path'
import { useStore } from '../useStore'
import { isTauri } from './isTauri'

const PROJECT_FOLDER = 'projects'
export const FILE_EXT = '.kcl'
export const PROJECT_ENTRYPOINT = 'main' + FILE_EXT
const INDEX_IDENTIFIER = '$n' // $nn.. will pad the number with 0s
export const MAX_PADDING = 7

// Initializes the project directory and returns the path
export async function initializeProjectDirectory() {
  if (!isTauri()) {
    throw new Error(
      'initializeProjectDirectory() can only be called from a Tauri app'
    )
  }
  const { defaultDir: projectDir, setDefaultDir } = useStore.getState()

  if (projectDir && projectDir.dir.length > 0) {
    const dirExists = await exists(projectDir.dir)
    if (!dirExists) {
      await createDir(projectDir.dir, { recursive: true })
    }
    return projectDir
  }

  const appData = await appDataDir()

  const INITIAL_DEFAULT_DIR = {
    dir: appData + PROJECT_FOLDER,
  }

  const defaultDirExists = await exists(INITIAL_DEFAULT_DIR.dir)

  if (!defaultDirExists) {
    await createDir(INITIAL_DEFAULT_DIR.dir, { recursive: true })
  }

  setDefaultDir(INITIAL_DEFAULT_DIR)
  return INITIAL_DEFAULT_DIR
}

// Creates a new file in the default directory with the default project name
// Returns the path to the new file
export async function createNewProject(path: string): Promise<FileEntry> {
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

  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path: path,
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
