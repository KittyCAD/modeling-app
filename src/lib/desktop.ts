import type { UserResponse } from '@kittycad/lib'
import { users } from '@kittycad/lib'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import type { JsonValue } from '@rust/kcl-lib/bindings/serde_json/JsonValue'
import env, { getEnvironmentNameFromEnv } from '@src/env'
import { newKclFile } from '@src/lang/project'
import {
  defaultAppSettings,
  parseAppSettings,
  parseProjectSettings,
} from '@src/lang/wasm'
import { getAppFolderName as getAppFolderNameFromMetadata } from '@src/lib/appFolderName'
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
import {
  FileAlreadyExists,
  FileNotFound,
  type FileStat,
} from '@src/lib/fileSystem/fileOperations'
import fsZds from '@src/lib/fs-zds'
import {
  appendGitignoreForDirectoryWithFs,
  createInitialGitignoreStackWithFs,
  fileOperationsGitignoreFs,
  type GitignoreStackEntry,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import type { FileEntry, FileMetadata, Project } from '@src/lib/project'
import {
  getDefaultDirectoryProjectLibraryPath,
  isProjectLibrarySettings,
} from '@src/lib/projectLibraries'
import {
  getCloudProjectIdFromProjectTomlContents,
  getProjectIdFromProjectTomlContents,
  getProjectTitleFromProjectTomlContents,
  preserveProjectTomlMetadataInProjectSettingsContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { err } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import { getInVariableCase, isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { IS_STAGING, IS_STAGING_OR_DEBUG } from '@src/routes/utils'

const textDecoder = new TextDecoder()

function getProjectSettingsSection(
  config: DeepPartial<Configuration> | Configuration
): { [key: string]: JsonValue } | undefined {
  const projectSettings = config.settings?.project
  return projectSettings &&
    typeof projectSettings === 'object' &&
    !isArray(projectSettings)
    ? projectSettings
    : undefined
}

function getProjectDirectorySetting(
  config: DeepPartial<Configuration> | Configuration
): string | undefined {
  const libraries = getProjectLibrarySettingsFromConfiguration(config)
  if (libraries) {
    return getDefaultDirectoryProjectLibraryPath(libraries)
  }

  const directory = getProjectSettingsSection(config)?.directory
  return typeof directory === 'string' ? directory : undefined
}

function getProjectLibrarySettingsFromConfiguration(
  config: DeepPartial<Configuration> | Configuration
) {
  const libraries = config.settings?.app?.libraries
  return isProjectLibrarySettings(libraries) ? libraries : undefined
}

const convertFileStatToFileMetadata = (
  stats: FileStat | null
): FileMetadata | null => {
  if (!stats) {
    return null
  }
  return {
    modified: stats.modifiedAt,
    accessed: stats.accessedAt,
    created: stats.createdAt,
    // this is not used anywhere and we use statIsDirectory in other places
    // that need to know if it's a file or directory.
    type: null,
    size: stats.size,
    permission: null,
  }
}

export function isPathNotFoundError(error: unknown) {
  return (
    error instanceof FileNotFound ||
    error === 'ENOENT' ||
    (typeof error === 'string' && error.startsWith('ENOENT')) ||
    (typeof error === 'object' &&
      error !== null &&
      (('code' in error && error.code === 'ENOENT') ||
        ('cause' in error && error.cause === 'ENOENT') ||
        ('message' in error &&
          typeof error.message === 'string' &&
          error.message.startsWith('ENOENT'))))
  )
}

async function readProjectTomlMetadata(
  fileOperations: FileOperationsRegistryService,
  projectPath: string
) {
  const projectTomlPath = fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  try {
    const projectToml = textDecoder.decode(
      await fileOperations.readFile(projectTomlPath)
    )
    const environmentName = getEnvironmentNameFromEnv(env())
    return {
      title: getProjectTitleFromProjectTomlContents(projectToml),
      projectId: getProjectIdFromProjectTomlContents(projectToml),
      cloudProjectId: getCloudProjectIdFromProjectTomlContents(
        projectToml,
        environmentName
      ),
    }
  } catch {
    return {
      title: undefined,
      projectId: undefined,
      cloudProjectId: undefined,
    }
  }
}

async function ensureProjectTomlTitle({
  fileOperations,
  projectPath,
  title,
  defaultFile,
  readExistingProjectToml = true,
}: {
  fileOperations: FileOperationsRegistryService
  projectPath: string
  title: string
  defaultFile: string
  readExistingProjectToml?: boolean
}) {
  const projectTomlPath = fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  let projectToml = ''
  if (readExistingProjectToml) {
    try {
      projectToml = textDecoder.decode(
        await fileOperations.readFile(projectTomlPath)
      )
    } catch (error) {
      if (!isPathNotFoundError(error)) {
        return Promise.reject(error)
      }
    }
  }

  if (getProjectTitleFromProjectTomlContents(projectToml)) {
    return
  }

  const projectTomlWithDefaultFile = /^\s*default_file\s*=/m.test(projectToml)
    ? projectToml
    : `default_file = ${JSON.stringify(defaultFile.replaceAll('\\', '/'))}\n${
        projectToml.trim() ? `\n${projectToml}` : ''
      }`
  const nextProjectToml = setProjectTitleInProjectTomlContents(
    projectTomlWithDefaultFile,
    title
  )
  await fileOperations.writeFile(projectTomlPath, nextProjectToml)
}

export async function renameProjectDirectory(
  fileOperations: FileOperationsRegistryService,
  projectPath: string,
  newName: string
): Promise<string> {
  if (!newName) {
    return Promise.reject(new Error(`New name for project cannot be empty`))
  }

  try {
    await fileOperations.stat(projectPath)
  } catch (e) {
    if (isPathNotFoundError(e)) {
      return Promise.reject(new Error(`Path ${projectPath} is not a directory`))
    }
  }

  // Make sure the new name does not exist.
  const newPath = fsZds.join(fsZds.dirname(projectPath), newName)
  try {
    await fileOperations.stat(newPath)
    // If we get here it means the stat succeeded and there's a file already
    // with the same name...
    return Promise.reject(
      new Error(
        `Path ${newPath} already exists, cannot rename to an existing path`
      )
    )
  } catch (e) {
    // Otherwise if it failed and the failure is "it doesn't exist" then rename it!
    if (isPathNotFoundError(e)) {
      await fileOperations.rename(projectPath, newPath)
      return newPath
    }
  }
  return Promise.reject(new Error('Unreachable'))
}

export async function ensureProjectDirectoryExists(
  fileOperations: FileOperationsRegistryService,
  config: DeepPartial<Configuration>
): Promise<string | undefined> {
  const projectDir = getProjectDirectorySetting(config)
  if (!projectDir) {
    console.error('projectDir is falsey', config)
    return Promise.reject(new Error('projectDir is falsey'))
  }
  try {
    await fileOperations.stat(projectDir)
  } catch (e) {
    if (isPathNotFoundError(e)) {
      try {
        await fileOperations.createDirectory(projectDir)
      } catch (createError) {
        if (!(createError instanceof FileAlreadyExists)) {
          return Promise.reject(createError)
        }
      }
    } else {
      return Promise.reject(e)
    }
  }

  return projectDir
}

export async function mkdirOrNOOP(
  fileOperations: FileOperationsRegistryService,
  directoryPath: string
) {
  try {
    await fileOperations.stat(directoryPath)
  } catch (e) {
    if (isPathNotFoundError(e)) {
      try {
        await fileOperations.createDirectory(directoryPath)
      } catch (createError) {
        if (!(createError instanceof FileAlreadyExists)) {
          return Promise.reject(createError)
        }
      }
    } else {
      return Promise.reject(e)
    }
  }

  return directoryPath
}

export async function createNewProjectDirectory(
  fileOperations: FileOperationsRegistryService,
  projectName: string,
  wasmInstance: ModuleType,
  initialCode?: string,
  configuration?: DeepPartial<Configuration> | Error,
  initialFileName?: string,
  overrideApplicationProjectDirectory?: string,
  projectTitle = projectName
): Promise<Project> {
  if (!configuration) {
    configuration = await readAppSettingsFile(fileOperations, wasmInstance)
  }

  if (err(configuration)) {
    return Promise.reject(configuration)
  }
  const mainDir =
    overrideApplicationProjectDirectory ||
    (await ensureProjectDirectoryExists(fileOperations, configuration))

  if (!projectName) {
    return Promise.reject('Project name cannot be empty.')
  }

  if (!mainDir) {
    return Promise.reject(new Error('mainDir is falsey'))
  }
  const projectDir = fsZds.join(mainDir, projectName)

  let projectDirectoryCreated = false
  try {
    await fileOperations.stat(projectDir)
  } catch (e) {
    if (isPathNotFoundError(e)) {
      try {
        await fileOperations.createDirectory(projectDir)
        projectDirectoryCreated = true
      } catch (createError) {
        if (!(createError instanceof FileAlreadyExists)) {
          return Promise.reject(createError)
        }
      }
    } else {
      return Promise.reject(e)
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
  if (err(codeToWrite)) {
    return Promise.reject(codeToWrite)
  }
  await fileOperations.writeFile(projectFile, codeToWrite)
  await ensureProjectTomlTitle({
    fileOperations,
    projectPath: projectDir,
    title: projectTitle,
    defaultFile: kclFileName,
    readExistingProjectToml: !projectDirectoryCreated,
  })
  let metadata: FileMetadata | null = null
  try {
    metadata = convertFileStatToFileMetadata(
      await fileOperations.stat(projectFile)
    )
  } catch (e) {
    if (isPathNotFoundError(e)) {
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
    title: projectTitle,
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
  fileOperations: FileOperationsRegistryService,
  initPromise: Promise<ModuleType> | ModuleType,
  configuration?: DeepPartial<Configuration> | Error
): Promise<Project[]> {
  // Make sure we have wasm initialized.
  const wasmInstance = await initPromise

  if (configuration === undefined) {
    configuration = await readAppSettingsFile(
      fileOperations,
      wasmInstance
    ).catch((e) => {
      console.error(e)
      return e
    })
  }

  if (err(configuration) || !configuration) {
    return Promise.reject(configuration)
  }
  const projectDir = await ensureProjectDirectoryExists(
    fileOperations,
    configuration
  )
  const projects = []
  if (!projectDir) {
    return Promise.reject(new Error('projectDir was falsey'))
  }

  // Gotcha: readdir will list all folders at this project directory even if you do not have readwrite access on the directory path
  const entries = (await fileOperations.readDirectory(projectDir)).map(
    (entry) => entry.name
  )

  const { value: canReadWriteProjectDirectory } = await canReadWriteDirectory(
    fileOperations,
    projectDir
  )

  for (const entry of entries) {
    // Skip directories that start with a dot
    if (entry.startsWith('.')) {
      continue
    }

    const projectPath = fsZds.join(projectDir, entry)

    // if it's not a directory ignore.
    // Gotcha: statIsDirectory will work even if you do not have read write permissions on the project path
    const isDirectory = await statIsDirectory(fileOperations, projectPath)
    if (!isDirectory) {
      continue
    }

    const project = await getProjectInfo(
      fileOperations,
      projectPath,
      wasmInstance
    )

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
  fileOperations: FileOperationsRegistryService,
  targetPath: string,
  projectRoot: string,
  canReadWritePath: boolean,
  showAllFiles: boolean,
  gitignoreStack: GitignoreStackEntry[]
) => {
  const configurationFileNames = new Set([
    SETTINGS_FILE_NAME,
    PROJECT_SETTINGS_FILE_NAME,
  ])

  let stats: FileStat
  // Make sure the filesystem object exists.
  try {
    stats = await fileOperations.stat(targetPath)
  } catch (e) {
    if (isPathNotFoundError(e)) {
      return Promise.reject(new Error(`Directory ${targetPath} does not exist`))
    }
    return Promise.reject(e)
  }

  // Make sure the path is a directory.
  const isPathDir = await statIsDirectory(fileOperations, targetPath)
  if (!isPathDir) {
    return Promise.reject(new Error(`Path ${targetPath} is not a directory`))
  }

  const name = fsZds.basename(targetPath)

  const entry: FileEntry = {
    name: name,
    path: targetPath,
    metadata: convertFileStatToFileMetadata(stats),
    children: [],
  }

  // If you cannot read/write this project path do not collect the files
  if (!canReadWritePath) {
    return entry
  }

  const children = []

  const entries = (await fileOperations.readDirectory(targetPath)).map(
    (entry) => entry.name
  )

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

  for (const e of entries) {
    // ignore hidden files and directories (starting with a dot)
    if (!showAllFiles && e.indexOf('.') === 0) {
      continue
    }

    const ePath = fsZds.join(targetPath, e)
    let eStats: FileStat
    try {
      eStats = await fileOperations.stat(ePath)
    } catch {
      continue
    }
    const isEDir = eStats.kind === 'directory'
    const relativePath = fsZds.relative(projectRoot, ePath).replace(/\\/g, '/')

    if (isPathIgnoredByGitignore(gitignoreStack, relativePath, isEDir)) {
      continue
    }

    if (isEDir) {
      const childGitignoreStack = await appendGitignoreForDirectoryWithFs(
        fileOperationsGitignoreFs(fileOperations),
        gitignoreStack,
        ePath,
        projectRoot
      )
      const subChildren = await collectAllFilesRecursiveFrom(
        fileOperations,
        ePath,
        projectRoot,
        canReadWritePath,
        showAllFiles,
        childGitignoreStack
      )
      children.push(subChildren)
    } else {
      if (!showAllFiles && configurationFileNames.has(e)) {
        continue
      }
      children.push(
        /* FileEntry */ {
          name: e,
          path: ePath,
          metadata: convertFileStatToFileMetadata(eStats),
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
  fileOperations: FileOperationsRegistryService,
  projectDir: string,
  file: FileEntry,
  wasmInstance: ModuleType
) {
  // Make sure the dir is a directory.
  const isFileEntryDir = await statIsDirectory(fileOperations, projectDir)
  if (!isFileEntryDir) {
    return Promise.reject(new Error(`Path ${projectDir} is not a directory`))
  }

  const defaultFilePath = fsZds.join(projectDir, PROJECT_ENTRYPOINT)
  try {
    await fileOperations.stat(defaultFilePath)
  } catch (e) {
    if (isPathNotFoundError(e)) {
      // Find a kcl file in the directory.
      if (file.children) {
        for (const entry of file.children) {
          if (entry.name.endsWith('.kcl')) {
            return fsZds.join(projectDir, entry.name)
          } else if ((entry.children?.length ?? 0) > 0) {
            // Recursively find a kcl file in the directory.
            return getDefaultKclFileForDir(
              fileOperations,
              entry.path,
              entry,
              wasmInstance
            )
          }
        }
        // If we didn't find a kcl file, create one.
        const configuration = await readAppSettingsFile(
          fileOperations,
          wasmInstance
        )
        if (err(configuration)) {
          return Promise.reject(configuration)
        }
        const codeToWrite = newKclFile(
          undefined,
          configuration?.settings?.modeling?.base_unit ??
            DEFAULT_DEFAULT_LENGTH_UNIT,
          wasmInstance
        )
        if (err(codeToWrite)) {
          return Promise.reject(codeToWrite)
        }
        await fileOperations.writeFile(defaultFilePath, codeToWrite)
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
    for (const entry of file.children) {
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
    for (const entry of file.children) {
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
  fileOperations: FileOperationsRegistryService,
  projectPath: string,
  wasmInstance: ModuleType
): Promise<Project> {
  // Check the directory.
  let stats: FileStat | undefined
  try {
    stats = await fileOperations.stat(projectPath)
  } catch (e) {
    if (isPathNotFoundError(e)) {
      return Promise.reject(
        new Error(`Project directory does not exist: ${projectPath}`)
      )
    }
  }

  // Make sure it is a directory.
  const projectPathIsDir = await statIsDirectory(fileOperations, projectPath)

  if (!projectPathIsDir) {
    return Promise.reject(
      new Error(`Project path is not a directory: ${projectPath}`)
    )
  }

  // Detect the projectPath has read write permission
  const { value: canReadWriteProjectPath } = await canReadWriteDirectory(
    fileOperations,
    projectPath
  )

  const appSettings = await readAppSettingsFile(fileOperations, wasmInstance)
  const showAllFiles = appSettings.settings?.app?.show_all_files === true

  const gitignoreStack = await createInitialGitignoreStackWithFs(
    fileOperationsGitignoreFs(fileOperations),
    projectPath
  )

  // Return walked early if canReadWriteProjectPath is false
  const walked = await collectAllFilesRecursiveFrom(
    fileOperations,
    projectPath,
    projectPath,
    canReadWriteProjectPath,
    showAllFiles,
    gitignoreStack
  )

  // If the projectPath does not have read write permissions, the default_file is empty string
  let default_file = ''
  if (canReadWriteProjectPath) {
    // Create the default main.kcl file only if the project path has read write permissions
    default_file = await getDefaultKclFileForDir(
      fileOperations,
      projectPath,
      walked,
      wasmInstance
    )
  }
  const projectTomlMetadata = canReadWriteProjectPath
    ? await readProjectTomlMetadata(fileOperations, projectPath)
    : { title: undefined, projectId: undefined, cloudProjectId: undefined }

  const project = {
    ...walked,
    ...projectTomlMetadata,
    metadata: convertFileStatToFileMetadata(stats ?? null),
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
export async function overwriteProjectTomlWithNewSettings(
  fileOperations: FileOperationsRegistryService,
  projectPath: string,
  tomlStr: string
): Promise<void> {
  const projectSettingsFilePath = await getProjectSettingsFilePath(projectPath)
  if (err(tomlStr)) {
    return Promise.reject(tomlStr)
  }
  let projectToml = tomlStr
  try {
    const existingProjectToml = textDecoder.decode(
      await fileOperations.readFile(projectSettingsFilePath)
    )
    projectToml = preserveProjectTomlMetadataInProjectSettingsContents(
      existingProjectToml,
      tomlStr
    )
  } catch (error) {
    if (!isPathNotFoundError(error)) {
      return Promise.reject(error)
    }
  }
  return fileOperations.writeFile(projectSettingsFilePath, projectToml)
}

export async function writeProjectTitleToProjectToml(
  fileOperations: FileOperationsRegistryService,
  projectPath: string,
  title: string
): Promise<void> {
  const projectSettingsFilePath = await getProjectSettingsFilePath(projectPath)
  let projectToml = ''
  try {
    projectToml = textDecoder.decode(
      await fileOperations.readFile(projectSettingsFilePath)
    )
  } catch (error) {
    if (!isPathNotFoundError(error)) {
      return Promise.reject(error)
    }
  }

  const nextProjectToml = setProjectTitleInProjectTomlContents(
    projectToml,
    title
  )
  await fileOperations.writeFile(projectSettingsFilePath, nextProjectToml)
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
  // /envs/<subdomain>.json e.g. /envs/dev.zoo.dev.json
  return fsZds.join(fullPath, `${environmentName}.json`)
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

  return fsZds.join(fullPath, TELEMETRY_RAW_FILE_NAME)
}

const getProjectSettingsFilePath = async (projectPath: string) => {
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
  fileOperations: FileOperationsRegistryService,
  projectPath: string,
  wasmInstance: ModuleType
): Promise<DeepPartial<ProjectConfiguration>> => {
  const settingsPath = await getProjectSettingsFilePath(projectPath)

  // Check if this file exists.
  try {
    await fileOperations.stat(settingsPath)
  } catch (e) {
    if (isPathNotFoundError(e)) {
      return {}
    }
  }

  const configToml = textDecoder.decode(
    await fileOperations.readFile(settingsPath)
  )
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
  fileOperations: FileOperationsRegistryService,
  wasmInstance: ModuleType
): Promise<DeepPartial<Configuration>> => {
  const settingsPath = await getAppSettingsFilePath()
  const initialProjectDirConfig: { [key: string]: JsonValue } = {
    directory: await getInitialDefaultDir(),
  }

  // The file exists, read it and parse it.
  try {
    await fileOperations.stat(settingsPath)
    const configToml = textDecoder.decode(
      await fileOperations.readFile(settingsPath)
    )
    const parsedAppConfig = parseAppSettings(configToml, wasmInstance)
    if (err(parsedAppConfig)) {
      return Promise.reject(parsedAppConfig)
    }

    const hasProjectDirectorySetting =
      getProjectDirectorySetting(parsedAppConfig)

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
            getProjectSettingsSection(parsedAppConfig),
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
          getProjectSettingsSection(defaultAppConfig),
          initialProjectDirConfig
        ),
      },
    }
    return mergedDefaultConfig
  }
}

export const writeAppSettingsFile = async (
  fileOperations: FileOperationsRegistryService,
  tomlStr: string
) => {
  const appSettingsFilePath = await getAppSettingsFilePath()
  if (err(tomlStr)) {
    return Promise.reject(tomlStr)
  }
  return fileOperations.writeFile(appSettingsFilePath, tomlStr)
}

export const readEnvironmentConfigurationFile = async (
  fileOperations: FileOperationsRegistryService,
  environmentName: string
): Promise<EnvironmentConfiguration | null> => {
  const path = await getEnvironmentConfigurationPath(environmentName)
  try {
    await fileOperations.stat(path)
    const configurationJSON = textDecoder.decode(
      await fileOperations.readFile(path)
    )
    if (!configurationJSON) {
      return null
    }
    return JSON.parse(configurationJSON)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e: unknown) {
    return null
  }
}

export const writeEnvironmentConfigurationToken = async (
  fileOperations: FileOperationsRegistryService,
  environmentName: string,
  token: string
) => {
  environmentName = environmentName.trim()
  const path = await getEnvironmentConfigurationPath(environmentName)
  const environmentConfiguration = await getEnvironmentConfigurationObject(
    fileOperations,
    environmentName
  )
  environmentConfiguration.token = token
  const requestedConfiguration = JSON.stringify(environmentConfiguration)
  const result = await fileOperations.writeFile(path, requestedConfiguration)
  console.log(`wrote ${environmentName}.json to disk`)
  return result
}

export const writeEnvironmentConfigurationKittycadWebSocketUrl = async (
  fileOperations: FileOperationsRegistryService,
  environmentName: string,
  kittycadWebSocketUrl: string
) => {
  kittycadWebSocketUrl = kittycadWebSocketUrl.trim()
  const path = await getEnvironmentConfigurationPath(environmentName)
  const environmentConfiguration = await getEnvironmentConfigurationObject(
    fileOperations,
    environmentName
  )
  environmentConfiguration.kittycadWebSocketUrl = kittycadWebSocketUrl
  const requestedConfiguration = JSON.stringify(environmentConfiguration)
  const result = await fileOperations.writeFile(path, requestedConfiguration)
  console.log(`wrote ${environmentName}.json to disk`)
  return result
}

export const getEnvironmentConfigurationObject = async (
  fileOperations: FileOperationsRegistryService,
  environmentName: string
) => {
  let environmentConfiguration = await readEnvironmentConfigurationFile(
    fileOperations,
    environmentName
  )
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
  fileOperations: FileOperationsRegistryService,
  environmentName: string
) => {
  const environmentConfiguration = await readEnvironmentConfigurationFile(
    fileOperations,
    environmentName
  )
  if (!environmentConfiguration?.token) {
    return ''
  }
  return environmentConfiguration.token.trim()
}

export const readEnvironmentConfigurationKittycadWebSocketUrl = async (
  fileOperations: FileOperationsRegistryService,
  environmentName: string
) => {
  const environmentConfiguration = await readEnvironmentConfigurationFile(
    fileOperations,
    environmentName
  )
  if (!environmentConfiguration?.kittycadWebSocketUrl) {
    return ''
  }
  return environmentConfiguration.kittycadWebSocketUrl.trim()
}

export const writeEnvironmentConfigurationZookeeperWebSocketUrl = async (
  fileOperations: FileOperationsRegistryService,
  environmentName: string,
  zookeeperWebSocketUrl: string
) => {
  zookeeperWebSocketUrl = zookeeperWebSocketUrl.trim()
  const path = await getEnvironmentConfigurationPath(environmentName)
  const environmentConfiguration = await getEnvironmentConfigurationObject(
    fileOperations,
    environmentName
  )
  environmentConfiguration.zookeeperWebSocketUrl = zookeeperWebSocketUrl
  const requestedConfiguration = JSON.stringify(environmentConfiguration)
  const result = await fileOperations.writeFile(path, requestedConfiguration)
  console.log(`wrote ${environmentName}.json to disk`)
  return result
}

export const readEnvironmentConfigurationZookeeperWebSocketUrl = async (
  fileOperations: FileOperationsRegistryService,
  environmentName: string
) => {
  const environmentConfiguration = await readEnvironmentConfigurationFile(
    fileOperations,
    environmentName
  )
  const zookeeperWebSocketUrl =
    environmentConfiguration?.zookeeperWebSocketUrl ??
    environmentConfiguration?.mlephantWebSocketUrl
  if (!zookeeperWebSocketUrl) {
    return ''
  }
  return zookeeperWebSocketUrl.trim()
}

export const readEnvironmentFile = async (
  fileOperations: FileOperationsRegistryService
) => {
  const environmentFilePath = await getEnvironmentFilePath()
  console.log(readEnvironmentFile)

  try {
    await fileOperations.stat(environmentFilePath)
    const environment = textDecoder.decode(
      await fileOperations.readFile(environmentFilePath)
    )
    if (!environment) {
      return ''
    }
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
export const writeEnvironmentFile = async (
  fileOperations: FileOperationsRegistryService,
  environment: string
) => {
  environment = environment.trim()
  const environmentFilePath = await getEnvironmentFilePath()
  if (err(environment)) {
    return Promise.reject(environment)
  }
  const result = await fileOperations.writeFile(
    environmentFilePath,
    environment
  )
  console.log('environment written to disk')
  return result
}

export const listAllEnvironments = async (
  fileOperations: FileOperationsRegistryService
) => {
  const environmentFolder = await getEnvironmentConfigurationFolderPath()
  const files = (await fileOperations.readDirectory(environmentFolder)).map(
    (entry) => entry.name
  )
  const suffix = '.json'
  return files
    .filter((fileName: string) => {
      return fileName.endsWith(suffix)
    })
    .map((fileName: string) => {
      return fileName.substring(0, fileName.length - suffix.length)
    })
}

export const listAllEnvironmentsWithTokens = async (
  fileOperations: FileOperationsRegistryService
) => {
  const environments = await listAllEnvironments(fileOperations)
  const environmentsWithTokens = []
  for (let i = 0; i < environments.length; i++) {
    const environment = environments[i]
    const token = await readEnvironmentConfigurationToken(
      fileOperations,
      environment
    )
    if (token) {
      environmentsWithTokens.push(environment)
    }
  }
  return environmentsWithTokens
}

export const writeTelemetryFile = async (
  fileOperations: FileOperationsRegistryService,
  content: string
) => {
  const telemetryFilePath = await getTelemetryFilePath()
  if (err(content)) {
    return Promise.reject(content)
  }
  return fileOperations.writeFile(telemetryFilePath, content)
}

export const writeRawTelemetryFile = async (
  fileOperations: FileOperationsRegistryService,
  content: string
) => {
  const rawTelemetryFilePath = await getRawTelemetryFilePath()
  if (err(content)) {
    return Promise.reject(content)
  }
  return fileOperations.writeFile(rawTelemetryFilePath, content)
}

let appStateStore: Project | undefined

export const getState = async (): Promise<Project | undefined> => {
  return Promise.resolve(appStateStore)
}

export const setState = async (state: Project | undefined): Promise<void> => {
  appStateStore = state
}

export const getUser = async (token: string): Promise<UserResponse> => {
  const client = createKCClient(token)
  const res = await kcCall(() => users.get_user_self({ client }))
  if (res instanceof Error) {
    return Promise.reject(res)
  }
  return res
}

export const writeProjectThumbnailFile = async (
  fileOperations: FileOperationsRegistryService,
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
    await fileOperations.stat(gitignorePath)
  } catch {
    await fileOperations.writeFile(gitignorePath, `${PROJECT_IMAGE_NAME}\n`)
  }

  return fileOperations.writeFile(filePath, asArray)
}

export function getPathFilenameInVariableCase(targetPath: string) {
  // from https://nodejs.org/en/learn/manipulating-files/nodejs-file-paths#example
  const basenameNoExt = fsZds.basename(targetPath, fsZds.extname(targetPath))
  return getInVariableCase(basenameNoExt)
}

export const canReadWriteDirectory = async (
  fileOperations: FileOperationsRegistryService,
  targetPath: string
): Promise<{ value: boolean; error: unknown }> => {
  const isDirectory = await statIsDirectory(fileOperations, targetPath)
  if (!isDirectory) {
    return {
      value: false,
      error: new Error('path is not a directory. Do not send a file path.'),
    }
  }

  try {
    return {
      value: await fileOperations.canReadWrite(targetPath),
      error: undefined,
    }
  } catch (e) {
    console.error(e)
    return { value: false, error: e }
  }
}

export async function statIsDirectory(
  fileOperations: FileOperationsRegistryService,
  targetPath: string
): Promise<boolean> {
  try {
    const res = await fileOperations.stat(targetPath)
    return res.kind === 'directory'
  } catch (e) {
    if (isPathNotFoundError(e)) {
      console.error('File does not exist', e)
      return false
    }
    return false // either way we don't know if it is a directory
  }
}
