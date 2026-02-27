import type { IElectronAPI } from '@root/interface'
import type { User } from '@kittycad/lib'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import { type IStat } from '@src/lib/fs-zds/interface'
import { users } from '@kittycad/lib'
import { createKCClient, kcCall } from '@src/lib/kcClient'

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'

import { newKclFile } from '@src/lang/project'
import {
  defaultAppSettings,
  parseAppSettings,
  parseProjectSettings,
} from '@src/lang/wasm'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
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
import env from '@src/env'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { getEXTNoPeriod, isExtensionARelevantExtension } from '@src/lib/paths'
import { getAppFolderName as getAppFolderNameFromMetadata } from '@src/lib/appFolderName'

const convertIStatToFileMetadata = (
  stats: IStat | null
): FileMetadata | null => {
  if (!stats) {
    return null
  }
  return {
    modified: stats.mtimeMs,
    accessed: stats.atimeMs,
    created: stats.ctimeMs,
    // this is not used anywhere and we use statIsDirectory in other places
    // that need to know if it's a file or directory.
    type: null,
    size: stats.size,
    permission: null,
  }
}

export async function renameProjectDirectory(
  projectPath: string,
  newName: string
): Promise<string> {
  if (!newName) {
    return Promise.reject(new Error(`New name for project cannot be empty`))
  }

  try {
    await fsZds.stat(projectPath)
  } catch (e) {
    if (e === 'ENOENT') {
      return Promise.reject(new Error(`Path ${projectPath} is not a directory`))
    }
  }

  // Make sure the new name does not exist.
  const newPath = fsZds.join(fsZds.dirname(projectPath), newName)
  try {
    await fsZds.stat(newPath)
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
      await fsZds.rename(projectPath, newPath)
      return newPath
    }
  }
  return Promise.reject(new Error('Unreachable'))
}

export async function ensureProjectDirectoryExists(
  config: DeepPartial<Configuration>
): Promise<string | undefined> {
  const projectDir = config.settings?.project?.directory
  if (!projectDir) {
    console.error('projectDir is falsey', config)
    return Promise.reject(new Error('projectDir is falsey'))
  }
  try {
    await fsZds.stat(projectDir)
  } catch (e) {
    if (e === 'ENOENT') {
      await fsZds.mkdir(projectDir, { recursive: true })
    }
  }

  return projectDir
}

export async function mkdirOrNOOP(directoryPath: string) {
  try {
    await fsZds.stat(directoryPath)
  } catch (e) {
    if (e === 'ENOENT') {
      await fsZds.mkdir(directoryPath, { recursive: true })
    }
  }

  return directoryPath
}

export async function createNewProjectDirectory(
  projectName: string,
  wasmInstance: ModuleType,
  initialCode?: string,
  configuration?: DeepPartial<Configuration> | Error,
  initialFileName?: string,
  overrideApplicationProjectDirectory?: string
): Promise<Project> {
  if (!configuration) {
    configuration = await readAppSettingsFile(wasmInstance)
  }

  if (err(configuration)) return Promise.reject(configuration)
  const mainDir =
    overrideApplicationProjectDirectory ||
    (await ensureProjectDirectoryExists(configuration))

  if (!projectName) {
    return Promise.reject('Project name cannot be empty.')
  }

  if (!mainDir) {
    return Promise.reject(new Error('mainDir is falsey'))
  }
  const projectDir = fsZds.join(mainDir, projectName)

  try {
    await fsZds.stat(projectDir)
  } catch (e) {
    if (e === 'ENOENT') {
      await fsZds.mkdir(projectDir, { recursive: true })
    }
  }

  const kclFileName = initialFileName || PROJECT_ENTRYPOINT
  const projectFile = fsZds.join(projectDir, kclFileName)
  // When initialCode is present, we're loading existing code.  If it's not
  // present, we're creating a new project, and we want to incorporate the
  // user's settings.
  const codeToWrite = newKclFile(
    initialCode,
    configuration?.settings?.modeling?.base_unit ?? DEFAULT_DEFAULT_LENGTH_UNIT,
    wasmInstance
  )
  if (err(codeToWrite)) return Promise.reject(codeToWrite)
  await fsZds.writeFile(projectFile, new TextEncoder().encode(codeToWrite))
  let metadata: FileMetadata | null = null
  try {
    metadata = convertIStatToFileMetadata(await fsZds.stat(projectFile))
  } catch (e) {
    if (e === 'ENOENT') {
      console.error('File does not exist')
      return Promise.reject(new Error(`File ${projectFile} does not exist`))
    }
  }
  if (metadata === undefined || metadata === null) {
    console.error('File does not exist')
    return Promise.reject(new Error(`File ${projectFile} does not exist`))
  }

  return {
    path: projectDir,
    name: projectName,
    // We don't need to recursively get all files in the project directory.
    // Because we just created it and it's empty.
    children: null,
    default_file: projectFile,
    metadata: {
      ...metadata,
      type: 'directory',
      size: metadata.size,
    },
    kcl_file_count: 1,
    directory_count: 0,
    // If the mkdir did not crash you have readWriteAccess
    readWriteAccess: true,
  }
}

export async function listProjects(
  initPromise: Promise<ModuleType> | ModuleType,
  configuration?: DeepPartial<Configuration> | Error
): Promise<Project[]> {
  // Make sure we have wasm initialized.
  const wasmInstance = await initPromise

  if (configuration === undefined) {
    configuration = await readAppSettingsFile(wasmInstance).catch((e) => {
      console.error(e)
      return e
    })
  }

  if (err(configuration) || !configuration) return Promise.reject(configuration)
  const projectDir = await ensureProjectDirectoryExists(configuration)
  const projects = []
  if (!projectDir) return Promise.reject(new Error('projectDir was falsey'))

  // Gotcha: readdir will list all folders at this project directory even if you do not have readwrite access on the directory path
  const entries = await fsZds.readdir(projectDir)

  const { value: canReadWriteProjectDirectory } =
    await canReadWriteDirectory(projectDir)

  for (let entry of entries) {
    // Skip directories that start with a dot
    if (entry.startsWith('.')) {
      continue
    }

    const projectPath = fsZds.join(projectDir, entry)

    // if it's not a directory ignore.
    // Gotcha: statIsDirectory will work even if you do not have read write permissions on the project path
    const isDirectory = await statIsDirectory(projectPath)
    if (!isDirectory) {
      continue
    }

    const project = await getProjectInfo(projectPath, wasmInstance)

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
  targetPath: string,
  canReadWritePath: boolean,
  fileExtensionsForFilter: string[]
) => {
  const isRelevantFile = (filename: string): boolean => {
    const extensionNoPeriod = getEXTNoPeriod(filename)
    if (!extensionNoPeriod) {
      return false
    }
    return isExtensionARelevantExtension(
      extensionNoPeriod,
      fileExtensionsForFilter
    )
  }

  // Make sure the filesystem object exists.
  try {
    await fsZds.stat(targetPath)
  } catch (e) {
    if (e === 'ENOENT') {
      return Promise.reject(new Error(`Directory ${targetPath} does not exist`))
    }
  }

  // Make sure the path is a directory.
  const isPathDir = await statIsDirectory(targetPath)
  if (!isPathDir) {
    return Promise.reject(new Error(`Path ${targetPath} is not a directory`))
  }

  const name = fsZds.basename(targetPath)

  let entry: FileEntry = {
    name: name,
    path: targetPath,
    children: [],
  }

  // If you cannot read/write this project path do not collect the files
  if (!canReadWritePath) {
    return entry
  }

  const children = []

  const entries = await fsZds.readdir(targetPath)

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

    const ePath = fsZds.join(targetPath, e)
    const isEDir = await statIsDirectory(ePath)

    if (isEDir) {
      const subChildren = await collectAllFilesRecursiveFrom(
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
  projectDir: string,
  file: FileEntry
) {
  // Make sure the dir is a directory.
  const isFileEntryDir = await statIsDirectory(projectDir)
  if (!isFileEntryDir) {
    return Promise.reject(new Error(`Path ${projectDir} is not a directory`))
  }

  let defaultFilePath = fsZds.join(projectDir, PROJECT_ENTRYPOINT)
  try {
    await fsZds.stat(defaultFilePath)
  } catch (e) {
    if (e === 'ENOENT') {
      // Find a kcl file in the directory.
      if (file.children) {
        for (let entry of file.children) {
          if (entry.name.endsWith('.kcl')) {
            return fsZds.join(projectDir, entry.name)
          } else if ((entry.children?.length ?? 0) > 0) {
            // Recursively find a kcl file in the directory.
            return getDefaultKclFileForDir(entry.path, entry)
          }
        }
        // If we didn't find a kcl file, create one.
        await fsZds.writeFile(defaultFilePath, new Uint8Array())
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
  projectPath: string,
  wasmInstance: ModuleType
): Promise<Project> {
  // Check the directory.
  let stats: IStat | undefined
  try {
    stats = await fsZds.stat(projectPath)
  } catch (e) {
    if (e === 'ENOENT') {
      return Promise.reject(
        new Error(`Project directory does not exist: ${projectPath}`)
      )
    }
  }

  // Make sure it is a directory.
  const projectPathIsDir = await statIsDirectory(projectPath)

  if (!projectPathIsDir) {
    return Promise.reject(
      new Error(`Project path is not a directory: ${projectPath}`)
    )
  }

  // Detect the projectPath has read write permission
  const { value: canReadWriteProjectPath } =
    await canReadWriteDirectory(projectPath)

  const fileExtensionsForFilter = relevantFileExtensions(wasmInstance)
  // Return walked early if canReadWriteProjectPath is false
  let walked = await collectAllFilesRecursiveFrom(
    projectPath,
    canReadWriteProjectPath,
    fileExtensionsForFilter
  )

  // If the projectPath does not have read write permissions, the default_file is empty string
  let default_file = ''
  if (canReadWriteProjectPath) {
    // Create the default main.kcl file only if the project path has read write permissions
    default_file = await getDefaultKclFileForDir(projectPath, walked)
  }

  let project = {
    ...walked,
    metadata: convertIStatToFileMetadata(stats ?? null),
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
  projectPath: string,
  tomlStr: string
): Promise<void> {
  const projectSettingsFilePath = await getProjectSettingsFilePath(projectPath)
  if (err(tomlStr)) return Promise.reject(tomlStr)
  return fsZds.writeFile(
    projectSettingsFilePath,
    new TextEncoder().encode(tomlStr)
  )
}

const getAppFolderName = () => {
  const platform =
    window.electron?.platform ??
    (window.electron?.os.isLinux
      ? 'linux'
      : window.electron?.os.isMac
        ? 'darwin'
        : window.electron?.os.isWindows
          ? 'win32'
          : 'unknown')
  return getAppFolderNameFromMetadata({
    packageName: window.electron?.packageJson.name ?? 'zoo-modeling-app',
    platform,
    isStaging: IS_STAGING,
    isStagingOrDebug: IS_STAGING_OR_DEBUG,
  })
}

export const getAppSettingsFilePath = async () => {
  const isTestEnv = env().NODE_ENV === 'test'

  const appConfig = await fsZds.getPath('appData')
  let fullPath = fsZds.resolve(appConfig, getAppFolderName())

  if (isTestEnv && window.electron) {
    const testSettingsPath = await window.electron.getAppTestProperty(
      'TEST_SETTINGS_FILE_KEY'
    )

    if (testSettingsPath) {
      fullPath = fsZds.resolve(testSettingsPath, '..')
    }
  }

  try {
    await fsZds.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await fsZds.mkdir(fullPath, { recursive: true })
    }
  }
  return fsZds.join(fullPath, SETTINGS_FILE_NAME)
}

export const getEnvironmentConfigurationFolderPath = async () => {
  const isTestEnv = env().NODE_ENV === 'test'
  const appConfig = await fsZds.getPath('appData')

  if (isTestEnv && window.electron) {
    const testSettingsPath = await window.electron.getAppTestProperty(
      'TEST_SETTINGS_FILE_KEY'
    )
    if (testSettingsPath) {
      return fsZds.resolve(testSettingsPath, '..')
    }
  }

  return fsZds.join(
    appConfig,
    getAppFolderName(),
    ENVIRONMENT_CONFIGURATION_FOLDER
  )
}

export const getEnvironmentConfigurationPath = async (
  environmentName: string
) => {
  const fullPath = await getEnvironmentConfigurationFolderPath()
  try {
    await fsZds.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await fsZds.mkdir(fullPath, { recursive: true })
    }
  }
  // /envs/<subdomain>.json e.g. /envs/dev.zoo.dev.json
  return fsZds.join(fullPath, environmentName + '.json')
}

export const getEnvironmentFilePath = async () => {
  const isTestEnv = env().NODE_ENV === 'test'
  const appConfig = await fsZds.getPath('appData')

  let fullPath = fsZds.join(appConfig, getAppFolderName())

  if (isTestEnv && window.electron) {
    const testSettingsPath = await window.electron.getAppTestProperty(
      'TEST_SETTINGS_FILE_KEY'
    )
    if (testSettingsPath) {
      fullPath = fsZds.resolve(testSettingsPath, '..')
    }
  }

  try {
    await fsZds.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await fsZds.mkdir(fullPath, { recursive: true })
    }
  }
  return fsZds.join(fullPath, ENVIRONMENT_FILE_NAME)
}

const getTelemetryFilePath = async () => {
  const isTestEnv = env().NODE_ENV === 'test'

  const appConfig = await fsZds.getPath('appData')
  let fullPath = fsZds.join(appConfig, getAppFolderName())

  if (isTestEnv && window.electron) {
    const testSettingsPath = await window.electron.getAppTestProperty(
      'TEST_SETTINGS_FILE_KEY'
    )
    if (testSettingsPath) {
      fullPath = fsZds.resolve(testSettingsPath, '..')
    }
  }

  try {
    await fsZds.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await fsZds.mkdir(fullPath, { recursive: true })
    }
  }
  return fsZds.join(fullPath, TELEMETRY_FILE_NAME)
}

const getRawTelemetryFilePath = async () => {
  const isTestEnv = env().NODE_ENV === 'test'

  const appConfig = await fsZds.getPath('appData')
  let fullPath = fsZds.join(appConfig, getAppFolderName())

  if (isTestEnv && window.electron) {
    const testSettingsPath = await window.electron.getAppTestProperty(
      'TEST_SETTINGS_FILE_KEY'
    )
    if (testSettingsPath) {
      fullPath = fsZds.resolve(testSettingsPath, '..')
    }
  }

  try {
    await fsZds.stat(fullPath)
  } catch (e) {
    // File/path doesn't exist
    if (e === 'ENOENT') {
      await fsZds.mkdir(fullPath, { recursive: true })
    }
  }
  return fsZds.join(fullPath, TELEMETRY_RAW_FILE_NAME)
}

const getProjectSettingsFilePath = async (projectPath: string) => {
  try {
    await fsZds.stat(projectPath)
  } catch (e) {
    if (e === 'ENOENT') {
      await fsZds.mkdir(projectPath, { recursive: true })
    }
  }
  return fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
}

export const getInitialDefaultDir = async () => {
  const isTestEnv = env().NODE_ENV === 'test'

  if (isTestEnv && window.electron) {
    const testSettingsPath = await window.electron.getAppTestProperty(
      'TEST_SETTINGS_FILE_KEY'
    )

    if (testSettingsPath) {
      return testSettingsPath
    }
  }
  const dir = await fsZds.getPath('documents')
  return fsZds.join(dir, PROJECT_FOLDER)
}

export const readProjectSettingsFile = async (
  projectPath: string,
  wasmInstance: ModuleType
): Promise<DeepPartial<ProjectConfiguration>> => {
  let settingsPath = await getProjectSettingsFilePath(projectPath)

  // Check if this file exists.
  try {
    await fsZds.stat(settingsPath)
  } catch (e) {
    if (e === 'ENOENT') {
      return {}
    }
  }

  const configToml = await fsZds.readFile(settingsPath, {
    encoding: 'utf-8',
  })
  const configObj = parseProjectSettings(configToml, wasmInstance)
  if (err(configObj)) {
    return Promise.reject(configObj)
  }
  return configObj
}

/**
 * Read the app settings file, or creates an initial one if it doesn't exist.
 */
export const readAppSettingsFile = async (
  wasmInstance: ModuleType
): Promise<DeepPartial<Configuration>> => {
  let settingsPath = await getAppSettingsFilePath()
  const initialProjectDirConfig: DeepPartial<
    NonNullable<Required<Configuration>['settings']['project']>
  > = { directory: await getInitialDefaultDir() }

  // The file exists, read it and parse it.
  try {
    await fsZds.stat(settingsPath)
    const configToml = await fsZds.readFile(settingsPath, {
      encoding: 'utf-8',
    })
    const parsedAppConfig = parseAppSettings(configToml, wasmInstance)
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e: unknown) {
    console.log('creating default app settings')

    // The file doesn't exist, create a new one.
    const defaultAppConfig = defaultAppSettings(wasmInstance)
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
}

export const writeAppSettingsFile = async (tomlStr: string) => {
  const appSettingsFilePath = await getAppSettingsFilePath()
  if (err(tomlStr)) return Promise.reject(tomlStr)
  return fsZds.writeFile(appSettingsFilePath, new TextEncoder().encode(tomlStr))
}

export const readEnvironmentConfigurationFile = async (
  environmentName: string
): Promise<EnvironmentConfiguration | null> => {
  const path = await getEnvironmentConfigurationPath(environmentName)
  try {
    await fsZds.stat(path)
    const configurationJSON: string = await fsZds.readFile(path, {
      encoding: 'utf-8',
    })
    if (!configurationJSON) return null
    return JSON.parse(configurationJSON)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e: unknown) {
    return null
  }
}

export const writeEnvironmentConfigurationToken = async (
  environmentName: string,
  token: string
) => {
  environmentName = environmentName.trim()
  const path = await getEnvironmentConfigurationPath(environmentName)
  const environmentConfiguration =
    await getEnvironmentConfigurationObject(environmentName)
  environmentConfiguration.token = token
  const requestedConfiguration = JSON.stringify(environmentConfiguration)
  const result = await fsZds.writeFile(
    path,
    new TextEncoder().encode(requestedConfiguration)
  )
  console.log(`wrote ${environmentName}.json to disk`)
  return result
}

export const writeEnvironmentConfigurationKittycadWebSocketUrl = async (
  environmentName: string,
  kittycadWebSocketUrl: string
) => {
  kittycadWebSocketUrl = kittycadWebSocketUrl.trim()
  const path = await getEnvironmentConfigurationPath(environmentName)
  const environmentConfiguration =
    await getEnvironmentConfigurationObject(environmentName)
  environmentConfiguration.kittycadWebSocketUrl = kittycadWebSocketUrl
  const requestedConfiguration = JSON.stringify(environmentConfiguration)
  const result = await fsZds.writeFile(
    path,
    new TextEncoder().encode(requestedConfiguration)
  )
  console.log(`wrote ${environmentName}.json to disk`)
  return result
}

export const getEnvironmentConfigurationObject = async (
  environmentName: string
) => {
  let environmentConfiguration =
    await readEnvironmentConfigurationFile(environmentName)
  if (environmentConfiguration === null) {
    const initialConfiguration: EnvironmentConfiguration = {
      token: '',
      domain: environmentName,
    }
    environmentConfiguration = initialConfiguration
  }
  return environmentConfiguration
}

export const readEnvironmentConfigurationToken = async (
  environmentName: string
) => {
  const environmentConfiguration =
    await readEnvironmentConfigurationFile(environmentName)
  if (!environmentConfiguration?.token) return ''
  return environmentConfiguration.token.trim()
}

export const readEnvironmentConfigurationKittycadWebSocketUrl = async (
  environmentName: string
) => {
  const environmentConfiguration =
    await readEnvironmentConfigurationFile(environmentName)
  if (!environmentConfiguration?.kittycadWebSocketUrl) return ''
  return environmentConfiguration.kittycadWebSocketUrl.trim()
}

export const writeEnvironmentConfigurationMlephantWebSocketUrl = async (
  environmentName: string,
  mlephantWebSocketUrl: string
) => {
  mlephantWebSocketUrl = mlephantWebSocketUrl.trim()
  const path = await getEnvironmentConfigurationPath(environmentName)
  const environmentConfiguration =
    await getEnvironmentConfigurationObject(environmentName)
  environmentConfiguration.mlephantWebSocketUrl = mlephantWebSocketUrl
  const requestedConfiguration = JSON.stringify(environmentConfiguration)
  const result = await fsZds.writeFile(
    path,
    new TextEncoder().encode(requestedConfiguration)
  )
  console.log(`wrote ${environmentName}.json to disk`)
  return result
}

export const readEnvironmentConfigurationMlephantWebSocketUrl = async (
  environmentName: string
) => {
  const environmentConfiguration =
    await readEnvironmentConfigurationFile(environmentName)
  if (!environmentConfiguration?.mlephantWebSocketUrl) return ''
  return environmentConfiguration.mlephantWebSocketUrl.trim()
}

export const readEnvironmentFile = async () => {
  let environmentFilePath = await getEnvironmentFilePath()
  console.log(readEnvironmentFile)

  try {
    await fsZds.stat(environmentFilePath)
    const environment: string = await fsZds.readFile(environmentFilePath, {
      encoding: 'utf-8',
    })
    if (!environment) return ''
    return environment.trim()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e: unknown) {
    return ''
  }
}

/**
 * Store the last selected environment on disk to allow us to sign back into the correct
 * environment when they refresh the application or update the application.
 */
export const writeEnvironmentFile = async (environment: string) => {
  environment = environment.trim()
  const environmentFilePath = await getEnvironmentFilePath()
  if (err(environment)) return Promise.reject(environment)
  console.log('writing env file path')
  console.log(environmentFilePath)
  const result = await fsZds.writeFile(
    environmentFilePath,
    new TextEncoder().encode(environment)
  )
  console.log('environment written to disk')
  return result
}

export const listAllEnvironments = async () => {
  const environmentFolder = await getEnvironmentConfigurationFolderPath()
  const files = await fsZds.readdir(environmentFolder)
  const suffix = '.json'
  return files
    .filter((fileName: string) => {
      return fileName.endsWith(suffix)
    })
    .map((fileName: string) => {
      return fileName.substring(0, fileName.length - suffix.length)
    })
}

export const listAllEnvironmentsWithTokens = async () => {
  const environments = await listAllEnvironments()
  const environmentsWithTokens = []
  for (let i = 0; i < environments.length; i++) {
    const environment = environments[i]
    const token = await readEnvironmentConfigurationToken(environment)
    if (token) {
      environmentsWithTokens.push(environment)
    }
  }
  return environmentsWithTokens
}

export const writeTelemetryFile = async (content: string) => {
  const telemetryFilePath = await getTelemetryFilePath()
  if (err(content)) return Promise.reject(content)
  return fsZds.writeFile(telemetryFilePath, new TextEncoder().encode(content))
}

export const writeRawTelemetryFile = async (content: string) => {
  const rawTelemetryFilePath = await getRawTelemetryFilePath()
  if (err(content)) return Promise.reject(content)
  return fsZds.writeFile(
    rawTelemetryFilePath,
    new TextEncoder().encode(content)
  )
}

let appStateStore: Project | undefined = undefined

export const getState = async (): Promise<Project | undefined> => {
  return Promise.resolve(appStateStore)
}

export const setState = async (state: Project | undefined): Promise<void> => {
  appStateStore = state
}

export const getUser = async (token: string): Promise<User> => {
  const client = createKCClient(token)
  const res = await kcCall(() => users.get_user_self({ client }))
  if (res instanceof Error) return Promise.reject(res)
  return res
}

export const writeProjectThumbnailFile = async (
  dataUrl: string,
  projectDirectoryPath: string
) => {
  const filePath = fsZds.join(projectDirectoryPath, PROJECT_IMAGE_NAME)
  const data = atob(dataUrl.substring('data:image/png;base64,'.length))
  const asArray = new Uint8Array(data.length)
  for (let i = 0, len = data.length; i < len; ++i) {
    asArray[i] = data.charCodeAt(i)
  }

  // Configure Git to ignore the generated thumbnail
  const gitignorePath = fsZds.join(projectDirectoryPath, '.gitignore')
  try {
    await fsZds.stat(gitignorePath)
  } catch {
    await fsZds.writeFile(
      gitignorePath,
      new TextEncoder().encode(`${PROJECT_IMAGE_NAME}\n`)
    )
  }

  return fsZds.writeFile(filePath, asArray)
}

export function getPathFilenameInVariableCase(targetPath: string) {
  // from https://nodejs.org/en/learn/manipulating-files/nodejs-file-paths#example
  const basenameNoExt = fsZds.basename(targetPath, fsZds.extname(targetPath))
  return getInVariableCase(basenameNoExt)
}

export const canReadWriteDirectory = async (
  targetPath: string
): Promise<{ value: boolean; error: unknown }> => {
  const isDirectory = await statIsDirectory(targetPath)
  if (!isDirectory) {
    return {
      value: false,
      error: new Error('path is not a directory. Do not send a file path.'),
    }
  }

  // bitwise OR to check read and write permissions
  try {
    const canReadWrite = await fsZds.access(
      targetPath,
      fsZdsConstants.R_OK | fsZdsConstants.W_OK
    )
    // This function returns undefined. If it cannot access the path it will throw an error
    return canReadWrite === undefined
      ? { value: true, error: undefined }
      : { value: false, error: undefined }
  } catch (e) {
    console.error(e)
    return { value: false, error: e }
  }
}

export async function statIsDirectory(targetPath: string): Promise<boolean> {
  try {
    const res = await fsZds.stat(targetPath)
    return Boolean(res.mode & fsZdsConstants.S_IFDIR)
  } catch (e) {
    if (e === 'ENOENT') {
      console.error('File does not exist', e)
      return false
    }
    return false // either way we don't know if it is a directory
  }
}
