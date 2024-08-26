import { err } from 'lib/trap'
import { Models } from '@kittycad/lib'
import { Project, FileEntry } from 'lib/project'

import {
  defaultAppSettings,
  parseAppSettings,
  parseProjectSettings,
} from 'lang/wasm'
import {
  DEFAULT_HOST,
  PROJECT_ENTRYPOINT,
  PROJECT_FOLDER,
  PROJECT_SETTINGS_FILE_NAME,
  SETTINGS_FILE_NAME,
  TOKEN_FILE_NAME,
} from './constants'
import { DeepPartial } from './types'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'

export async function renameProjectDirectory(
  projectPath: string,
  newName: string
): Promise<string> {
  if (!newName) {
    return Promise.reject(new Error(`New name for project cannot be empty`))
  }

  try {
    await window.electron.stat(projectPath)
  } catch (e) {
    if (e === 'ENOENT') {
      return Promise.reject(new Error(`Path ${projectPath} is not a directory`))
    }
  }

  // Make sure the new name does not exist.
  const newPath = window.electron.path.join(
    window.electron.path.dirname(projectPath),
    newName
  )
  try {
    await window.electron.stat(newPath)
    // If we get here it means the stat succeeded and there's a file already
    // with the same name...
    return Promise.reject(
      new Error(
        `Path ${newPath} already exists, cannot rename to an existing path`
      )
    )
  } catch (e) {
    // Otherwise if it failed and the failure is "it doesn't exist" then rename it!
    if (e === 'ENOENT') {
      await window.electron.rename(projectPath, newPath)
      return newPath
    }
  }
  return Promise.reject(new Error('Unreachable'))
}

export async function ensureProjectDirectoryExists(
  config: DeepPartial<Configuration>
): Promise<string | undefined> {
  const projectDir =
    config.settings?.app?.project_directory ||
    config.settings?.project?.directory
  if (!projectDir) {
    console.error('projectDir is falsey', config)
    return Promise.reject(new Error('projectDir is falsey'))
  }
  try {
    await window.electron.stat(projectDir)
  } catch (e) {
    if (e === 'ENOENT') {
      await window.electron.mkdir(projectDir, { recursive: true })
    }
  }

  return projectDir
}

export async function createNewProjectDirectory(
  projectName: string,
  initialCode?: string,
  configuration?: DeepPartial<Configuration> | Error
): Promise<Project> {
  if (!configuration) {
    configuration = await readAppSettingsFile()
  }

  if (err(configuration)) return Promise.reject(configuration)
  const mainDir = await ensureProjectDirectoryExists(configuration)

  if (!projectName) {
    return Promise.reject('Project name cannot be empty.')
  }

  if (!mainDir) {
    return Promise.reject(new Error('mainDir is falsey'))
  }
  const projectDir = window.electron.path.join(mainDir, projectName)

  try {
    await window.electron.stat(projectDir)
  } catch (e) {
    if (e === 'ENOENT') {
      await window.electron.mkdir(projectDir, { recursive: true })
    }
  }

  const projectFile = window.electron.path.join(projectDir, PROJECT_ENTRYPOINT)
  await window.electron.writeFile(projectFile, initialCode ?? '')
  const metadata = await window.electron.stat(projectFile)

  return {
    path: projectDir,
    name: projectName,
    // We don't need to recursively get all files in the project directory.
    // Because we just created it and it's empty.
    children: null,
    default_file: projectFile,
    metadata,
    kcl_file_count: 1,
    directory_count: 0,
  }
}

export async function listProjects(
  configuration?: DeepPartial<Configuration> | Error
): Promise<Project[]> {
  if (configuration === undefined) {
    configuration = await readAppSettingsFile()
  }

  if (err(configuration)) return Promise.reject(configuration)
  const projectDir = await ensureProjectDirectoryExists(configuration)
  const projects = []
  if (!projectDir) return Promise.reject(new Error('projectDir was falsey'))

  const entries = await window.electron.readdir(projectDir)
  for (let entry of entries) {
    const projectPath = window.electron.path.join(projectDir, entry)
    // if it's not a directory ignore.
    const isDirectory = await window.electron.statIsDirectory(projectPath)
    if (!isDirectory) {
      continue
    }

    const project = await getProjectInfo(projectPath)
    // Needs at least one file to be added to the projects list
    if (project.kcl_file_count === 0) {
      continue
    }
    projects.push(project)
  }
  return projects
}

const IMPORT_FILE_EXTENSIONS = [
  // TODO Use ImportFormat enum
  'stp',
  'glb',
  'fbxb',
  'kcl',
]

const isRelevantFile = (filename: string): boolean =>
  IMPORT_FILE_EXTENSIONS.some((ext) => filename.endsWith('.' + ext))

const collectAllFilesRecursiveFrom = async (path: string) => {
  // Make sure the filesystem object exists.
  try {
    await window.electron.stat(path)
  } catch (e) {
    if (e === 'ENOENT') {
      return Promise.reject(new Error(`Directory ${path} does not exist`))
    }
  }

  // Make sure the path is a directory.
  const isPathDir = await window.electron.statIsDirectory(path)
  if (!isPathDir) {
    return Promise.reject(new Error(`Path ${path} is not a directory`))
  }

  const name = window.electron.path.basename(path)
  let entry: FileEntry = {
    name: name,
    path,
    children: [],
  }

  const children = []

  const entries = await window.electron.readdir(path)

  // Sort all entries so files come first and directories last
  // so a top-most KCL file is returned first.
  entries.sort((a: string, b: string) => {
    if (a.endsWith('.kcl') && !b.endsWith('.kcl')) {
      return -1
    }
    if (!a.endsWith('.kcl') && b.endsWith('.kcl')) {
      return 1
    }
    return 0
  })

  for (let e of entries) {
    // ignore hidden files and directories (starting with a dot)
    if (e.indexOf('.') === 0) {
      continue
    }

    const ePath = window.electron.path.join(path, e)
    const isEDir = await window.electron.statIsDirectory(ePath)

    if (isEDir) {
      const subChildren = await collectAllFilesRecursiveFrom(ePath)
      children.push(subChildren)
    } else {
      if (!isRelevantFile(ePath)) {
        continue
      }
      children.push(
        /* FileEntry */ {
          name: e,
          path: ePath,
          children: null,
        }
      )
    }
  }

  // We don't set this to none if there are no children, because it's a directory.
  entry.children = children

  return entry
}

export async function getDefaultKclFileForDir(
  projectDir: string,
  file: FileEntry
) {
  // Make sure the dir is a directory.
  const isFileEntryDir = await window.electron.statIsDirectory(projectDir)
  if (!isFileEntryDir) {
    return Promise.reject(new Error(`Path ${projectDir} is not a directory`))
  }

  let defaultFilePath = window.electron.path.join(
    projectDir,
    PROJECT_ENTRYPOINT
  )
  try {
    await window.electron.stat(defaultFilePath)
  } catch (e) {
    if (e === 'ENOENT') {
      // Find a kcl file in the directory.
      if (file.children) {
        for (let entry of file.children) {
          if (entry.name.endsWith('.kcl')) {
            return window.electron.path.join(projectDir, entry.name)
          } else if ((entry.children?.length ?? 0) > 0) {
            // Recursively find a kcl file in the directory.
            return getDefaultKclFileForDir(entry.path, entry)
          }
        }
        // If we didn't find a kcl file, create one.
        await window.electron.writeFile(defaultFilePath, '')
        return defaultFilePath
      }
    }
  }

  if (!file.children) {
    return file.name
  }

  return defaultFilePath
}

const kclFileCount = (file: FileEntry) => {
  let count = 0
  if (file.children) {
    for (let entry of file.children) {
      if (entry.name.endsWith('.kcl')) {
        count += 1
      } else {
        count += kclFileCount(entry)
      }
    }
  }

  return count
}

/// Populate the number of directories in the project.
const directoryCount = (file: FileEntry) => {
  let count = 0
  if (file.children) {
    for (let entry of file.children) {
      count += 1
      directoryCount(entry)
    }
  }

  return count
}

export async function getProjectInfo(projectPath: string): Promise<Project> {
  // Check the directory.
  try {
    await window.electron.stat(projectPath)
  } catch (e) {
    if (e === 'ENOENT') {
      return Promise.reject(
        new Error(`Project directory does not exist: ${projectPath}`)
      )
    }
  }

  // Make sure it is a directory.
  const projectPathIsDir = await window.electron.statIsDirectory(projectPath)
  if (!projectPathIsDir) {
    return Promise.reject(
      new Error(`Project path is not a directory: ${projectPath}`)
    )
  }
  let walked = await collectAllFilesRecursiveFrom(projectPath)
  let default_file = await getDefaultKclFileForDir(projectPath, walked)
  const metadata = await window.electron.stat(projectPath)

  let project = {
    ...walked,
    // We need to map from node fs.Stats to FileMetadata
    metadata: {
      modified: metadata.mtimeMs,
      accessed: metadata.atimeMs,
      created: metadata.ctimeMs,
      // this is not used anywhere and we use statIsDirectory in other places
      // that need to know if it's a file or directory.
      type: null,
      size: metadata.size,
      permission: metadata.mode,
    },
    kcl_file_count: 0,
    directory_count: 0,
    default_file,
  }

  // Populate the number of KCL files in the project.
  project.kcl_file_count = kclFileCount(project)

  //Populate the number of directories in the project.
  project.directory_count = directoryCount(project)

  return project
}

// Write project settings file.
export async function writeProjectSettingsFile(
  projectPath: string,
  tomlStr: string
): Promise<void> {
  const projectSettingsFilePath = await getProjectSettingsFilePath(projectPath)
  if (err(tomlStr)) return Promise.reject(tomlStr)
  return window.electron.writeFile(projectSettingsFilePath, tomlStr)
}

// Since we want backwards compatibility with the old settings file, we need to
// rename the folder for macos.
const MACOS_APP_NAME = 'dev.zoo.modeling-app'

const getAppFolderName = () => {
  if (window.electron.os.isMac || window.electron.os.isWindows) {
    return MACOS_APP_NAME
  }
  return window.electron.packageJson.name
}

const getAppSettingsFilePath = async () => {
  const isTestEnv = window.electron.process.env.IS_PLAYWRIGHT === 'true'
  const testSettingsPath = window.electron.process.env.TEST_SETTINGS_FILE_KEY
  const appConfig = await window.electron.getPath('appData')
  const fullPath = isTestEnv
    ? testSettingsPath
    : window.electron.path.join(appConfig, getAppFolderName())
  try {
    await window.electron.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await window.electron.mkdir(fullPath, { recursive: true })
    }
  }
  return window.electron.path.join(fullPath, SETTINGS_FILE_NAME)
}
const getTokenFilePath = async () => {
  const isTestEnv = window.electron.process.env.IS_PLAYWRIGHT === 'true'
  const testSettingsPath = window.electron.process.env.TEST_SETTINGS_FILE_KEY
  const appConfig = await window.electron.getPath('appData')
  const fullPath = isTestEnv
    ? testSettingsPath
    : window.electron.path.join(appConfig, getAppFolderName())
  try {
    await window.electron.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await window.electron.mkdir(fullPath, { recursive: true })
    }
  }
  return window.electron.path.join(fullPath, TOKEN_FILE_NAME)
}

const getProjectSettingsFilePath = async (projectPath: string) => {
  try {
    await window.electron.stat(projectPath)
  } catch (e) {
    if (e === 'ENOENT') {
      await window.electron.mkdir(projectPath, { recursive: true })
    }
  }
  return window.electron.path.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
}

export const getInitialDefaultDir = async () => {
  if (!window.electron) {
    return ''
  }
  const dir = await window.electron.getPath('documents')
  return window.electron.path.join(dir, PROJECT_FOLDER)
}

export const readProjectSettingsFile = async (
  projectPath: string
): Promise<DeepPartial<ProjectConfiguration>> => {
  let settingsPath = await getProjectSettingsFilePath(projectPath)

  // Check if this file exists.
  try {
    await window.electron.stat(settingsPath)
  } catch (e) {
    if (e === 'ENOENT') {
      // Return the default configuration.
      return {}
    }
  }

  const configToml = await window.electron.readFile(settingsPath)
  const configObj = parseProjectSettings(configToml)
  if (err(configObj)) {
    return Promise.reject(configObj)
  }
  return configObj
}

/**
 * Read the app settings file, or creates an initial one if it doesn't exist.
 */
export const readAppSettingsFile = async () => {
  let settingsPath = await getAppSettingsFilePath()

  // The file exists, read it and parse it.
  if (window.electron.exists(settingsPath)) {
    const configToml = await window.electron.readFile(settingsPath)
    const configObj = parseAppSettings(configToml)
    if (err(configObj)) {
      return Promise.reject(configObj)
    }

    return configObj
  }

  // The file doesn't exist, create a new one.
  // This defaultAppConfig is truly an empty object every time.
  const defaultAppConfig = defaultAppSettings()
  if (err(defaultAppConfig)) {
    return Promise.reject(defaultAppConfig)
  }
  const initialDirConfig: DeepPartial<Configuration> = {
    settings: { project: { directory: await getInitialDefaultDir() } },
  }
  const config = Object.assign(defaultAppConfig, initialDirConfig)
  return config
}

export const writeAppSettingsFile = async (tomlStr: string) => {
  const appSettingsFilePath = await getAppSettingsFilePath()
  if (err(tomlStr)) return Promise.reject(tomlStr)
  return window.electron.writeFile(appSettingsFilePath, tomlStr)
}

export const readTokenFile = async () => {
  let settingsPath = await getTokenFilePath()

  if (window.electron.exists(settingsPath)) {
    const token: string = await window.electron.readFile(settingsPath)
    if (!token) return ''

    return token
  }
  return ''
}

export const writeTokenFile = async (token: string) => {
  const tokenFilePath = await getTokenFilePath()
  if (err(token)) return Promise.reject(token)
  return window.electron.writeFile(tokenFilePath, token)
}

let appStateStore: Project | undefined = undefined

export const getState = async (): Promise<Project | undefined> => {
  return Promise.resolve(appStateStore)
}

export const setState = async (state: Project | undefined): Promise<void> => {
  appStateStore = state
}

export const getUser = async (
  token: string,
  hostname: string
): Promise<Models['User_type']> => {
  // Use the host passed in if it's set.
  // Otherwise, use the default host.
  const host = !hostname ? DEFAULT_HOST : hostname

  // Change the baseURL to the one we want.
  let baseurl = host
  if (!(host.indexOf('http://') === 0) && !(host.indexOf('https://') === 0)) {
    baseurl = `https://${host}`
    if (host.indexOf('localhost') === 0) {
      baseurl = `http://${host}`
    }
  }

  // Use kittycad library to fetch the user info from /user/me
  if (baseurl !== DEFAULT_HOST) {
    // The TypeScript generated library uses environment variables for this
    // because it was intended for NodeJS.
    // Needs to stay like this because window.electron.kittycad needs it
    // internally.
    window.electron.setBaseUrl(baseurl)
  }

  try {
    const user = await window.electron.kittycad('users.get_user_self', {
      client: { token },
    })
    return user
  } catch (e) {
    console.error(e)
  }
  return Promise.reject(new Error('unreachable'))
}
