import type { Models } from '@kittycad/lib'

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'

import { newKclFile } from '@src/lang/project'
import {
  defaultAppSettings,
  parseAppSettings,
  parseProjectSettings,
} from '@src/lang/wasm'
import { initPromise, relevantFileExtensions } from '@src/lang/wasmUtils'
import { fsManager } from '@src/lang/std/fileSystemManager'
import type { EnvironmentConfiguration } from '@src/lib/constants'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  ENVIRONMENT_CONFIGURATION_FOLDER,
  ENVIRONMENT_FILE_NAME,
  PROJECT_ENTRYPOINT,
  PROJECT_FOLDER,
  PROJECT_IMAGE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
  SETTINGS_FILE_NAME,
  TELEMETRY_FILE_NAME,
  TELEMETRY_RAW_FILE_NAME,
} from '@src/lib/constants'
import type { FileEntry, FileMetadata, Project } from '@src/lib/project'
import { err } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import { getInVariableCase } from '@src/lib/utils'
import { IS_STAGING, IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import type { IElectronAPI } from '@root/interface'

export async function renameProjectDirectory(
  electron: IElectronAPI,
  projectPath: string,
  newName: string
): Promise<string> {
  if (!newName) {
    return Promise.reject(new Error(`New name for project cannot be empty`))
  }

  try {
    await electron.stat(projectPath)
  } catch (e) {
    if (e === 'ENOENT') {
      return Promise.reject(new Error(`Path ${projectPath} is not a directory`))
    }
  }

  // Make sure the new name does not exist.
  const newPath = fsManager.path.join(
    fsManager.path.dirname(projectPath),
    newName
  )
  try {
    await electron.stat(newPath)
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
      await electron.rename(projectPath, newPath)
      return newPath
    }
  }
  return Promise.reject(new Error('Unreachable'))
}

export async function ensureProjectDirectoryExists(
  electron: IElectronAPI,
  config: DeepPartial<Configuration>
): Promise<string | undefined> {
  const projectDir = config.settings?.project?.directory
  if (!projectDir) {
    console.error('projectDir is falsey', config)
    return Promise.reject(new Error('projectDir is falsey'))
  }
  try {
    await electron.stat(projectDir)
  } catch (e) {
    if (e === 'ENOENT') {
      await electron.mkdir(projectDir, { recursive: true })
    }
  }

  return projectDir
}

export async function mkdirOrNOOP(
  electron: IElectronAPI,
  directoryPath: string
) {
  try {
    await electron.stat(directoryPath)
  } catch (e) {
    if (e === 'ENOENT') {
      await electron.mkdir(directoryPath, { recursive: true })
    }
  }

  return directoryPath
}

export async function createNewProjectDirectory(
  electron: IElectronAPI,
  projectName: string,
  initialCode?: string,
  configuration?: DeepPartial<Configuration> | Error,
  initialFileName?: string
): Promise<Project> {
  if (!configuration) {
    configuration = await readAppSettingsFile(electron)
  }

  if (err(configuration)) return Promise.reject(configuration)
  const mainDir = await ensureProjectDirectoryExists(electron, configuration)

  if (!projectName) {
    return Promise.reject('Project name cannot be empty.')
  }

  if (!mainDir) {
    return Promise.reject(new Error('mainDir is falsey'))
  }
  const projectDir = fsManager.path.join(mainDir, projectName)

  try {
    await electron.stat(projectDir)
  } catch (e) {
    if (e === 'ENOENT') {
      await electron.mkdir(projectDir, { recursive: true })
    }
  }

  const kclFileName = initialFileName || PROJECT_ENTRYPOINT
  const projectFile = fsManager.path.join(projectDir, kclFileName)
  // When initialCode is present, we're loading existing code.  If it's not
  // present, we're creating a new project, and we want to incorporate the
  // user's settings.
  const codeToWrite = newKclFile(
    initialCode,
    configuration?.settings?.modeling?.base_unit ?? DEFAULT_DEFAULT_LENGTH_UNIT
  )
  if (err(codeToWrite)) return Promise.reject(codeToWrite)
  await electron.writeFile(projectFile, codeToWrite)
  let metadata: FileMetadata | null = null
  try {
    metadata = await electron.stat(projectFile)
  } catch (e) {
    if (e === 'ENOENT') {
      console.error('File does not exist')
      return Promise.reject(new Error(`File ${projectFile} does not exist`))
    }
  }

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
    // If the mkdir did not crash you have readWriteAccess
    readWriteAccess: true,
  }
}

export async function listProjects(
  electron: IElectronAPI,
  configuration?: DeepPartial<Configuration> | Error
): Promise<Project[]> {
  // Make sure we have wasm initialized.
  const initializedResult = await initPromise
  if (err(initializedResult)) {
    return Promise.reject(initializedResult)
  }

  if (configuration === undefined) {
    configuration = await readAppSettingsFile(electron).catch((e) => {
      console.error(e)
      return e
    })
  }

  if (err(configuration) || !configuration) return Promise.reject(configuration)
  const projectDir = await ensureProjectDirectoryExists(electron, configuration)
  const projects = []
  if (!projectDir) return Promise.reject(new Error('projectDir was falsey'))

  // Gotcha: readdir will list all folders at this project directory even if you do not have readwrite access on the directory path
  const entries = await electron.readdir(projectDir)

  const { value: canReadWriteProjectDirectory } =
    await electron.canReadWriteDirectory(projectDir)

  for (let entry of entries) {
    // Skip directories that start with a dot
    if (entry.startsWith('.')) {
      continue
    }

    const projectPath = electron.path.join(projectDir, entry)

    // if it's not a directory ignore.
    // Gotcha: statIsDirectory will work even if you do not have read write permissions on the project path
    const isDirectory = await electron.statIsDirectory(projectPath)
    if (!isDirectory) {
      continue
    }

    const project = await getProjectInfo(electron, projectPath)

    if (
      project.kcl_file_count === 0 &&
      project.readWriteAccess &&
      canReadWriteProjectDirectory
    ) {
      continue
    }

    // Push folders you cannot readWrite to show users the issue
    projects.push(project)
  }

  return projects
}

const collectAllFilesRecursiveFrom = async (
  electron: IElectronAPI,
  path: string,
  canReadWritePath: boolean,
  fileExtensionsForFilter: string[]
) => {
  const isRelevantFile = (filename: string): boolean =>
    fileExtensionsForFilter.some((ext) => filename.endsWith('.' + ext))

  // Make sure the filesystem object exists.
  try {
    await electron.stat(path)
  } catch (e) {
    if (e === 'ENOENT') {
      return Promise.reject(new Error(`Directory ${path} does not exist`))
    }
  }

  // Make sure the path is a directory.
  const isPathDir = await electron.statIsDirectory(path)
  if (!isPathDir) {
    return Promise.reject(new Error(`Path ${path} is not a directory`))
  }

  const name = electron.path.basename(path)

  let entry: FileEntry = {
    name: name,
    path,
    children: [],
  }

  // If you cannot read/write this project path do not collect the files
  if (!canReadWritePath) {
    return entry
  }

  const children = []

  const entries = await electron.readdir(path)

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

    const ePath = electron.path.join(path, e)
    const isEDir = await electron.statIsDirectory(ePath)

    if (isEDir) {
      const subChildren = await collectAllFilesRecursiveFrom(
        electron,
        ePath,
        canReadWritePath,
        fileExtensionsForFilter
      )
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
  electron: IElectronAPI,
  projectDir: string,
  file: FileEntry
) {
  // Make sure the dir is a directory.
  const isFileEntryDir = await electron.statIsDirectory(projectDir)
  if (!isFileEntryDir) {
    return Promise.reject(new Error(`Path ${projectDir} is not a directory`))
  }

  let defaultFilePath = electron.path.join(projectDir, PROJECT_ENTRYPOINT)
  try {
    await electron.stat(defaultFilePath)
  } catch (e) {
    if (e === 'ENOENT') {
      // Find a kcl file in the directory.
      if (file.children) {
        for (let entry of file.children) {
          if (entry.name.endsWith('.kcl')) {
            return electron.path.join(projectDir, entry.name)
          } else if ((entry.children?.length ?? 0) > 0) {
            // Recursively find a kcl file in the directory.
            return getDefaultKclFileForDir(electron, entry.path, entry)
          }
        }
        // If we didn't find a kcl file, create one.
        await electron.writeFile(defaultFilePath, '')
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
      // We only want to count FileEntries with children, e.g. folders
      if (entry.children !== null) {
        count += 1
      }
      directoryCount(entry)
    }
  }

  return count
}

export async function getProjectInfo(
  electron: IElectronAPI,
  projectPath: string
): Promise<Project> {
  // Check the directory.
  let metadata
  try {
    metadata = await electron.stat(projectPath)
  } catch (e) {
    if (e === 'ENOENT') {
      return Promise.reject(
        new Error(`Project directory does not exist: ${projectPath}`)
      )
    }
  }

  // Make sure it is a directory.
  const projectPathIsDir = await electron.statIsDirectory(projectPath)

  if (!projectPathIsDir) {
    return Promise.reject(
      new Error(`Project path is not a directory: ${projectPath}`)
    )
  }

  // Detect the projectPath has read write permission
  const { value: canReadWriteProjectPath } =
    await electron.canReadWriteDirectory(projectPath)

  const fileExtensionsForFilter = relevantFileExtensions()
  // Return walked early if canReadWriteProjectPath is false
  let walked = await collectAllFilesRecursiveFrom(
    electron,
    projectPath,
    canReadWriteProjectPath,
    fileExtensionsForFilter
  )

  // If the projectPath does not have read write permissions, the default_file is empty string
  let default_file = ''
  if (canReadWriteProjectPath) {
    // Create the default main.kcl file only if the project path has read write permissions
    default_file = await getDefaultKclFileForDir(electron, projectPath, walked)
  }

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
    readWriteAccess: canReadWriteProjectPath,
  }

  // Populate the number of KCL files in the project.
  project.kcl_file_count = kclFileCount(project)

  //Populate the number of directories in the project.
  project.directory_count = directoryCount(project)

  return project
}

// Write project settings file.
export async function writeProjectSettingsFile(
  electron: IElectronAPI,
  projectPath: string,
  tomlStr: string
): Promise<void> {
  const projectSettingsFilePath = await getProjectSettingsFilePath(
    electron,
    projectPath
  )
  if (err(tomlStr)) return Promise.reject(tomlStr)
  return electron.writeFile(projectSettingsFilePath, tomlStr)
}

// Important for saving settings.
let APP_ID = 'dev.zoo.modeling-app'
if (IS_STAGING) {
  APP_ID = `${APP_ID}-staging`
} else if (IS_STAGING_OR_DEBUG) {
  APP_ID = `${APP_ID}-local`
}

const getAppFolderName = (electron: IElectronAPI) => {
  if (electron.os.isMac || electron.os.isWindows) {
    return APP_ID
  }
  // TODO: we need to make linux use the same convention this is weird
  // This variable below gets the -staging suffix on staging too thru scripts/flip-files-to-staging.sh
  // But it should be consistent with the reserve domain app id we use on Windows and Linux
  return electron.packageJson.name
}

export const getAppSettingsFilePath = async (electron: IElectronAPI) => {
  const isTestEnv = electron.process.env.NODE_ENV === 'test'
  const testSettingsPath = await electron.getAppTestProperty(
    'TEST_SETTINGS_FILE_KEY'
  )

  const appConfig = await electron.getPath('appData')

  const fullPath = isTestEnv
    ? fsManager.path.resolve(testSettingsPath, '..')
    : fsManager.path.resolve(appConfig, getAppFolderName(electron))

  try {
    await electron.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await electron.mkdir(fullPath, { recursive: true })
    }
  }
  return fsManager.path.join(fullPath, SETTINGS_FILE_NAME)
}

export const getEnvironmentConfigurationFolderPath = async (
  electron: IElectronAPI
) => {
  const isTestEnv = electron.process.env.NODE_ENV === 'test'
  const testSettingsPath = await electron.getAppTestProperty(
    'TEST_SETTINGS_FILE_KEY'
  )

  const appConfig = await electron.getPath('appData')
  const fullPath = isTestEnv
    ? electron.path.resolve(testSettingsPath, '..')
    : electron.path.join(
        appConfig,
        getAppFolderName(electron),
        ENVIRONMENT_CONFIGURATION_FOLDER
      )
  return fullPath
}

export const getEnvironmentConfigurationPath = async (
  electron: IElectronAPI,
  environmentName: string
) => {
  const fullPath = await getEnvironmentConfigurationFolderPath(electron)
  try {
    await electron.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await electron.mkdir(fullPath, { recursive: true })
    }
  }
  // /envs/<subdomain>.json e.g. /envs/dev.zoo.dev.json
  return electron.path.join(fullPath, environmentName + '.json')
}

export const getEnvironmentFilePath = async (electron: IElectronAPI) => {
  const isTestEnv = electron.process.env.NODE_ENV === 'test'
  const testSettingsPath = await electron.getAppTestProperty(
    'TEST_SETTINGS_FILE_KEY'
  )

  const appConfig = await electron.getPath('appData')
  const fullPath = isTestEnv
    ? electron.path.resolve(testSettingsPath, '..')
    : electron.path.join(appConfig, getAppFolderName(electron))
  try {
    await electron.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await electron.mkdir(fullPath, { recursive: true })
    }
  }
  return electron.path.join(fullPath, ENVIRONMENT_FILE_NAME)
}

const getTelemetryFilePath = async (electron: IElectronAPI) => {
  const isTestEnv = electron.process.env.NODE_ENV === 'test'
  const testSettingsPath = await electron.getAppTestProperty(
    'TEST_SETTINGS_FILE_KEY'
  )

  const appConfig = await electron.getPath('appData')
  const fullPath = isTestEnv
    ? electron.path.resolve(testSettingsPath, '..')
    : electron.path.join(appConfig, getAppFolderName(electron))
  try {
    await electron.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await electron.mkdir(fullPath, { recursive: true })
    }
  }
  return electron.path.join(fullPath, TELEMETRY_FILE_NAME)
}

const getRawTelemetryFilePath = async (electron: IElectronAPI) => {
  const isTestEnv = electron.process.env.NODE_ENV === 'test'
  const testSettingsPath = await electron.getAppTestProperty(
    'TEST_SETTINGS_FILE_KEY'
  )

  const appConfig = await electron.getPath('appData')
  const fullPath = isTestEnv
    ? electron.path.resolve(testSettingsPath, '..')
    : electron.path.join(appConfig, getAppFolderName(electron))
  try {
    await electron.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await electron.mkdir(fullPath, { recursive: true })
    }
  }
  return electron.path.join(fullPath, TELEMETRY_RAW_FILE_NAME)
}

const getProjectSettingsFilePath = async (
  electron: IElectronAPI,
  projectPath: string
) => {
  try {
    await electron.stat(projectPath)
  } catch (e) {
    if (e === 'ENOENT') {
      await electron.mkdir(projectPath, { recursive: true })
    }
  }
  return fsManager.path.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
}

export const getInitialDefaultDir = async (electron: IElectronAPI) => {
  const isTestEnv = electron.process.env.NODE_ENV === 'test'
  const testSettingsPath = await electron.getAppTestProperty(
    'TEST_SETTINGS_FILE_KEY'
  )

  if (isTestEnv) {
    return testSettingsPath
  }
  const dir = await electron.getPath('documents')
  return electron.path.join(dir, PROJECT_FOLDER)
}

export const readProjectSettingsFile = async (
  electron: IElectronAPI,
  projectPath: string
): Promise<DeepPartial<ProjectConfiguration>> => {
  let settingsPath = await getProjectSettingsFilePath(electron, projectPath)

  // Check if this file exists.
  try {
    await electron.stat(settingsPath)
  } catch (e) {
    if (e === 'ENOENT') {
      // Return the default configuration.
      return {}
    }
  }

  const configToml = await fsManager.readFile(settingsPath, {
    encoding: 'utf-8',
  })
  const configObj = parseProjectSettings(configToml)
  if (err(configObj)) {
    return Promise.reject(configObj)
  }
  return configObj
}

/**
 * Read the app settings file, or creates an initial one if it doesn't exist.
 */
export const readAppSettingsFile = async (electron: IElectronAPI) => {
  let settingsPath = await getAppSettingsFilePath(electron)
  const initialProjectDirConfig: DeepPartial<
    NonNullable<Required<Configuration>['settings']['project']>
  > = { directory: await getInitialDefaultDir(electron) }

  // The file exists, read it and parse it.
  if (await fsManager.exists(settingsPath)) {
    const configToml = await fsManager.readFile(settingsPath, {
      encoding: 'utf-8',
    })
    const parsedAppConfig = parseAppSettings(configToml)
    if (err(parsedAppConfig)) {
      return Promise.reject(parsedAppConfig)
    }

    const hasProjectDirectorySetting =
      parsedAppConfig.settings?.project?.directory

    if (hasProjectDirectorySetting) {
      return parsedAppConfig
    } else {
      // inject the default project directory setting
      const mergedConfig: DeepPartial<Configuration> = {
        ...parsedAppConfig,
        settings: {
          ...parsedAppConfig.settings,
          project: Object.assign(
            {},
            parsedAppConfig.settings?.project,
            initialProjectDirConfig
          ),
        },
      }
      return mergedConfig
    }
  }

  // The file doesn't exist, create a new one.
  const defaultAppConfig = defaultAppSettings()
  if (err(defaultAppConfig)) {
    return Promise.reject(defaultAppConfig)
  }

  // inject the default project directory setting
  const mergedDefaultConfig: DeepPartial<Configuration> = {
    ...defaultAppConfig,
    settings: {
      ...defaultAppConfig.settings,
      project: Object.assign(
        {},
        defaultAppConfig.settings?.project,
        initialProjectDirConfig
      ),
    },
  }
  return mergedDefaultConfig
}

export const writeAppSettingsFile = async (
  electron: IElectronAPI,
  tomlStr: string
) => {
  const appSettingsFilePath = await getAppSettingsFilePath(electron)
  if (err(tomlStr)) return Promise.reject(tomlStr)
  return electron.writeFile(appSettingsFilePath, tomlStr)
}

export const readEnvironmentConfigurationFile = async (
  electron: IElectronAPI,
  environmentName: string
): Promise<EnvironmentConfiguration | null> => {
  const path = await getEnvironmentConfigurationPath(electron, environmentName)
  if (electron.exists(path)) {
    const configurationJSON: string = await electron.readFile(path, {
      encoding: 'utf-8',
    })
    if (!configurationJSON) return null
    return JSON.parse(configurationJSON)
  }
  return null
}

export const writeEnvironmentConfigurationToken = async (
  electron: IElectronAPI,
  environmentName: string,
  token: string
) => {
  environmentName = environmentName.trim()
  const path = await getEnvironmentConfigurationPath(electron, environmentName)
  const environmentConfiguration = await getEnvironmentConfigurationObject(
    electron,
    environmentName
  )
  environmentConfiguration.token = token
  const requestedConfiguration = JSON.stringify(environmentConfiguration)
  const result = await electron.writeFile(path, requestedConfiguration)
  console.log(`wrote ${environmentName}.json to disk`)
  return result
}

export const writeEnvironmentConfigurationPool = async (
  electron: IElectronAPI,
  environmentName: string,
  pool: string
) => {
  pool = pool.trim()
  const path = await getEnvironmentConfigurationPath(electron, environmentName)
  const environmentConfiguration = await getEnvironmentConfigurationObject(
    electron,
    environmentName
  )
  environmentConfiguration.pool = pool
  const requestedConfiguration = JSON.stringify(environmentConfiguration)
  const result = await electron.writeFile(path, requestedConfiguration)
  console.log(`wrote ${environmentName}.json to disk`)
  return result
}

export const getEnvironmentConfigurationObject = async (
  electron: IElectronAPI,
  environmentName: string
) => {
  let environmentConfiguration = await readEnvironmentConfigurationFile(
    electron,
    environmentName
  )
  if (environmentConfiguration === null) {
    const initialConfiguration: EnvironmentConfiguration = {
      token: '',
      pool: '',
      domain: environmentName,
    }
    environmentConfiguration = initialConfiguration
  }
  return environmentConfiguration
}

export const readEnvironmentConfigurationPool = async (
  electron: IElectronAPI,
  environmentName: string
) => {
  const environmentConfiguration = await readEnvironmentConfigurationFile(
    electron,
    environmentName
  )
  if (!environmentConfiguration?.pool) return ''
  return environmentConfiguration.pool.trim()
}

export const readEnvironmentConfigurationToken = async (
  electron: IElectronAPI,
  environmentName: string
) => {
  const environmentConfiguration = await readEnvironmentConfigurationFile(
    electron,
    environmentName
  )
  if (!environmentConfiguration?.token) return ''
  return environmentConfiguration.token.trim()
}

export const readEnvironmentFile = async (electron: IElectronAPI) => {
  let environmentFilePath = await getEnvironmentFilePath(electron)

  if (electron.exists(environmentFilePath)) {
    const environment: string = await electron.readFile(environmentFilePath, {
      encoding: 'utf-8',
    })
    if (!environment) return ''
    return environment.trim()
  }
  return ''
}

/**
 * Store the last selected environment on disk to allow us to sign back into the correct
 * environment when they refresh the application or update the application.
 */
export const writeEnvironmentFile = async (
  electron: IElectronAPI,
  environment: string
) => {
  environment = environment.trim()
  const environmentFilePath = await getEnvironmentFilePath(electron)
  if (err(environment)) return Promise.reject(environment)
  const result = electron.writeFile(environmentFilePath, environment)
  console.log('environment written to disk')
  return result
}

export const listAllEnvironments = async (electron: IElectronAPI) => {
  const environmentFolder =
    await getEnvironmentConfigurationFolderPath(electron)
  const files = await electron.readdir(environmentFolder)
  const suffix = '.json'
  return files
    .filter((fileName: string) => {
      return fileName.endsWith(suffix)
    })
    .map((fileName: string) => {
      return fileName.substring(0, fileName.length - suffix.length)
    })
}

export const listAllEnvironmentsWithTokens = async (electron: IElectronAPI) => {
  const environments = await listAllEnvironments(electron)
  const environmentsWithTokens = []
  for (let i = 0; i < environments.length; i++) {
    const environment = environments[i]
    const token = await readEnvironmentConfigurationToken(electron, environment)
    if (token) {
      environmentsWithTokens.push(environment)
    }
  }
  return environmentsWithTokens
}

export const writeTelemetryFile = async (
  electron: IElectronAPI,
  content: string
) => {
  const telemetryFilePath = await getTelemetryFilePath(electron)
  if (err(content)) return Promise.reject(content)
  return electron.writeFile(telemetryFilePath, content)
}

export const writeRawTelemetryFile = async (
  electron: IElectronAPI,
  content: string
) => {
  const rawTelemetryFilePath = await getRawTelemetryFilePath(electron)
  if (err(content)) return Promise.reject(content)
  return electron.writeFile(rawTelemetryFilePath, content)
}

let appStateStore: Project | undefined = undefined

export const getState = async (): Promise<Project | undefined> => {
  return Promise.resolve(appStateStore)
}

export const setState = async (state: Project | undefined): Promise<void> => {
  appStateStore = state
}

export const getUser = async (token: string): Promise<Models['User_type']> => {
  try {
    const user = await fetch(withAPIBaseURL('/users/me'), {
      headers: new Headers({
        Authorization: `Bearer ${token}`,
      }),
    })
    return user.json()
  } catch (e) {
    console.error(e)
  }
  return Promise.reject(new Error('unreachable'))
}

export const writeProjectThumbnailFile = async (
  electron: IElectronAPI,
  dataUrl: string,
  projectDirectoryPath: string
) => {
  const filePath = electron.path.join(projectDirectoryPath, PROJECT_IMAGE_NAME)
  const data = atob(dataUrl.substring('data:image/png;base64,'.length))
  const asArray = new Uint8Array(data.length)
  for (let i = 0, len = data.length; i < len; ++i) {
    asArray[i] = data.charCodeAt(i)
  }
  return electron.writeFile(filePath, asArray)
}

export function getPathFilenameInVariableCase(path: string) {
  // from https://nodejs.org/en/learn/manipulating-files/nodejs-file-paths#example
  const basenameNoExt = fsManager.path.basename(
    path,
    fsManager.path.extname(path)
  )
  return getInVariableCase(basenameNoExt)
}
