import { Models } from '@kittycad/lib'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { Project } from 'wasm-lib/kcl/bindings/Project'
import { FileEntry } from 'wasm-lib/kcl/bindings/FileEntry'
import { ProjectState } from 'wasm-lib/kcl/bindings/ProjectState'
import { ProjectRoute } from 'wasm-lib/kcl/bindings/ProjectRoute'

import {
  defaultAppSettings,
  tomlStringify,
  parseAppSettings,
  parseProjectSettings,
} from 'lang/wasm'
export {
  parseProjectRoute,
} from 'lang/wasm'
import { SaveSettingsPayload } from 'lib/settings/settingsUtils'

const DEFAULT_HOST = 'https://api.zoo.dev'
const SETTINGS_FILE_NAME = 'settings.toml'
const PROJECT_SETTINGS_FILE_NAME = 'project.toml'
const PROJECT_FOLDER = 'zoo-modeling-app-projects'
const DEFAULT_PROJECT_KCL_FILE = "main.kcl"


export async function renameProjectDirectory(
  projectPath: string,
  newName: string
): Promise<string> {
  debugger
}

export async function showInFolder(path: string | undefined): Promise<void> {
  if (!path) {
    console.error('path is undefined cannot call desktop showInFolder')
    return
  }
  debugger
}

export async function ensureProjectDirectoryExists(
  config: Partial<SaveSettingsPayload>
): Promise<string | undefined> {
  const projectDir = config.app.projectDirectory
  try {
    await window.electron.stat(projectDir)
  } catch (e) {
    if (e === 'ENOENT') {
      window.electron.mkdir(projectDir, { recursive: true }, (e) => {
        console.log(e)
      })
    }
  }

  return projectDir
}

export async function createNewProjectDirectory(
  projectName: string,
  initialCode?: string,
  configuration?: Partial<SaveSettingsPayload>
): Promise<Project> {
  if (!configuration) {
    configuration = await readAppSettingsFile()
  }

  const mainDir = await ensureProjectDirectoryExists(configuration)

  if (!projectName) {
    return Promise.reject('Project name cannot be empty.')
  }

  const projectDir = window.electron.path.join(mainDir, projectName)

  try {
    await window.electron.stat(projectDir)
  } catch (e) {
    if (e === 'ENOENT') {
      window.electron.mkdir(projectDir, { recursive: true })
    }
  }

  const projectFile = window.electron.path.join(
    projectDir,
    DEFAULT_PROJECT_KCL_FILE
  )
  await window.electron.writeFile(projectFile, initialCode ?? '')

  return {
    file: {
      path: projectDir,
      name: projectName,
      // We don't need to recursively get all files in the project directory.
      // Because we just created it and it's empty.
      children: undefined,
    },
    default_file: projectFile,
    metadata: undefined /* TODO */,
    kcl_file_count: 1,
    directory_count: 0,
  }
}

export async function listProjects(
  configuration?: Partial<SaveSettingsPayload>
): Promise<Project[]> {
  const projectDir = await ensureProjectDirectoryExists(configuration)
  const projects = []
  const entries = await window.electron.readdir(projectDir)
  for (let entry of entries) {
    const projectPath = window.electron.path.join(projectDir, entry)
    // if it's not a directory ignore.
    const isDirectory = await window.electron.statIsDirectory(projectPath)
    if (!isDirectory) { continue }

    const project = await getProjectInfo(projectPath)
    // Needs at least one file to be added to the projects list
    if (project.kcl_file_count === 0) { continue }
    projects.push(project)
  }
  return projects
}

const IMPORT_FILE_EXTENSIONS = [
  // TODO Use ImportFormat enum
  "stp", "glb", "fbxb", "kcl"
];

const isRelevantFile = (filename: string): boolean => IMPORT_FILE_EXTENSIONS.some(
  (ext) => filename.endsWith('.' + ext))

const collectAllFilesRecursiveFrom = async (path: string) => {
    // Make sure the filesystem object exists.
    try { await window.electron.stat(path) }
    catch (e) {
      if (e === 'ENOENT') {
        return Promise.reject(new Error(`Directory ${path} does not exist`))
      }
    }

    // Make sure the path is a directory.
    const isPathDir = await window.electron.statIsDirectory(path)
    if (!isPathDir) {
        return Promise.reject(new Error(`Path ${path} is not a directory`));
    }

    const pathParts = path.split('/')
    let entry = /* FileEntry */ {
        name: pathParts.slice(-1)[0],
        path: pathParts.slice(0, -1).join('/'),
        children: [],
    }

    const children = []

    const entries = await window.electron.readdir(path)

    for (let e of entries) {
        // ignore hidden files and directories (starting with a dot)
        if (e.indexOf('.') === 0) { continue }

        const ePath = window.electron.path.join(path, e)
        const isEDir = await window.electron.statIsDirectory(ePath)

        if (isEDir) {
            const subChildren = await collectAllFilesRecursiveFrom(ePath)
            children.push(subChildren)
        } else {
            if (!isRelevantFile(ePath)) { continue }
            children.push(/* FileEntry */ {
                name: e,
                path: ePath.split('/').slice(0, -1).join('/'),
                children: undefined,
            });
        }
    }

    // We don't set this to none if there are no children, because it's a directory.
    entry.children = children

    return entry
}

const getDefaultKclFileForDir = async (projectDir, file) => {
    // Make sure the dir is a directory.
    const isFileEntryDir = await window.electron.statIsDirectory(file.path)
    if (!isFileEntryDir) {
      return Promise.reject(new Error(`Path ${file.path} is not a directory`))
    }

    let defaultFilePath = window.electron.path.join(file.path, DEFAULT_PROJECT_KCL_FILE)
    try { await window.eletron.stat(defaultFilePath) }
    catch (e) {
      if (e === 'ENOENT') {
        // Find a kcl file in the directory.
          if (file.children) {
            for (let entry of file.children) {
              if (entry.name.endsWith(".kcl")) {
                  return window.electron.path.join(projectDir, entry.name)
              } else if (entry.children.is_some()) {
                  // Recursively find a kcl file in the directory.
                  return getDefaultKclFileForDir(entry.path, entry)
              }
            }
          }
      }
  }

  // If we didn't find a kcl file, create one.
  await window.electron.writeFile(defaultFilePath, '')
  return defaultFilePath
}

const kclFileCount = (file /* fileEntry */) => {
    let count = 0;
    if (file.children) {
        for (let entry of file.children) {
            if (entry.name.endsWith(".kcl")) {
                count += 1
            } else {
                count += kclFileCount(entry)
            }
        }
    }

  return count
}

/// Populate the number of directories in the project.
const directoryCount = (file /* FileEntry */) => {
    let count = 0
    if (file.children) {
        for (let entry of file.children) {
            count += 1
            directoryCount(entry)
        }
    }

  return count
}


export async function getProjectInfo(
  projectPath: string,
): Promise<Project> {
    // Check the directory.
    try { await window.electron.stat(projectPath) }
    catch (e) {
      if (e === 'ENOENT') {
        return Promise.reject(new Error(`Project directory does not exist: ${project_path}`));
      }
    }

    // Make sure it is a directory.
    const projectPathIsDir = await window.electron.statIsDirectory(projectPath)
    if (!projectPathIsDir) {
        return Promise.reject(new Error(`Project path is not a directory: ${project_path}`));
    }

    let walked = await collectAllFilesRecursiveFrom(projectPath)
    let default_file = await getDefaultKclFileForDir(projectPath, walked)

    let project = /* FileEntry */ {
        file: walked,
        metadata: undefined,
        kcl_file_count: 0,
        directory_count: 0,
        default_file,
    };

    // Populate the number of KCL files in the project.
    project.kcl_file_count = kclFileCount(project.file)

    //Populate the number of directories in the project.
    project.directory_count = directoryCount(project.file)

    return project
}

export async function readDirRecursive(path: string): Promise<FileEntry[]> {
  debugger
}

// Write project settings file.
export async function writeProjectSettingsFile({
  projectPath,
  configuration,
}: {
  projectPath: string
  configuration: Partial<SaveSettingsPayload>
}): Promise<void> {
  const projectSettingsFilePath = await getProjectSettingsFilePath(projectPath)
  const tomlStr = tomlStringify(configuration)
  return window.electron.writeFile(projectSettingsFilePath, tomlStr)
}

const getAppSettingsFilePath = async () => {
  const appConfig = await window.electron.getPath('appData')
  const fullPath = window.electron.path.join(
    appConfig,
    window.electron.packageJson.name
  )
  try {
    await window.electron.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e.code === 'ENOENT') {
      window.electron.mkdir(fullPath, { recursive: true })
    }
  }
  return window.electron.path.join(fullPath, SETTINGS_FILE_NAME)
}

const getProjectSettingsFilePath = async (projectPath: string) => {
  try {
    await window.electron.stat(projectPath)
  } catch (e) {
    if (e.code === 'ENOENT') {
      window.electron.mkdir(projectPath, { recursive: true })
    }
  }
  return window.electron.path.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
}

export const getInitialDefaultDir = async () => {
  const dir = await window.electron.getPath('documents')
  return window.electron.path.join(dir, PROJECT_FOLDER)
}

export const readProjectSettingsFile = async (projectPath: string): ProjectConfiguration => {
    let settingsPath = await getProjectSettingsFilePath(projectPath)

    // Check if this file exists.
    try { await window.electron.stat(settingsPath) }
    catch (e) {
      if (e === 'ENOENT') {
          // Return the default configuration.
          return {}
      }
    }


  const configToml = await window.electron.readFile(settingsPath)
  const configObj = parseProjectSettings(configToml)
  return configObj
}

export const readAppSettingsFile = async () => {
  let settingsPath = await getAppSettingsFilePath()
  try {
    await window.electron.stat(settingsPath)
  } catch (e) {
    if (e === 'ENOENT') {
      const config = defaultAppSettings()
      config.app.projectDirectory = await getInitialDefaultDir()
      return config
    }
  }
  const configToml = await window.electron.readFile(settingsPath)
  const configObj = parseAppSettings(configToml)
  return configObj
}

export const writeAppSettingsFile = async (
  config: Partial<SaveSettingsPayload>
) => {
  const appSettingsFilePath = await getAppSettingsFilePath()
  const tomlStr = tomlStringify(config)
  return window.electron.writeFile(appSettingsFilePath, tomlStr)
}

let appStateStore = undefined

export const getState = async (): Promise<ProjectState | undefined> => {
  return Promise.resolve(appStateStore)
}

export const setState = async (
  state: ProjectState | undefined
): Promise<void> => {
  appStateStore = state
}

export const login = () => {
  console.log('STUB')
}

export const getUser = async (
  token: string,
  hostname: string
): Models['User_type'] => {
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
  if (baseurl != DEFAULT_HOST) {
    // The TypeScript generated library uses environment variables for this
    // because it was intended for NodeJS.
    window.electron.process.env.BASE_URL(baseurl)
  }

  const user = await window.electron.kittycad.users.get_user_self({
    client: { token },
  })
  return user
}

