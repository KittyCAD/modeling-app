import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import { APP_NAME, ARCHIVE_DIR, IS_PLAYWRIGHT_KEY } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { webSafeJoin } from '@src/lib/pathUtils'
import {
  getDefaultDirectoryProjectLibraryPath,
  isProjectLibrarySettings,
} from '@src/lib/projectLibraries'

import type { FileEntry, Project } from '@src/lib/project'
import { err } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

const SETTINGS = '/settings'
const HOME = '/home'
const LIBRARY = '/library'

export type ProjectRoute = {
  projectName: string | null
  projectPath: string
  currentFileName: string | null
  currentFilePath: string | null
}

function getProjectDirectorySetting(
  configuration: DeepPartial<Configuration>
): string | undefined {
  const libraries = configuration.settings?.app?.libraries
  if (isProjectLibrarySettings(libraries)) {
    return getDefaultDirectoryProjectLibraryPath(libraries)
  }

  const projectSettings = configuration.settings?.project
  if (
    !projectSettings ||
    typeof projectSettings !== 'object' ||
    isArray(projectSettings)
  ) {
    return undefined
  }

  const directory = projectSettings.directory
  return typeof directory === 'string' ? directory : undefined
}

function getRelativePathIfContained(
  parentDirectory: string,
  targetPath: string
): string | undefined {
  const relativePath = fsZds.relative(parentDirectory, targetPath)
  if (relativePath === '') {
    return relativePath
  }
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${fsZds.sep}`) ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\') ||
    /^[a-zA-Z]:/.test(relativePath)
  ) {
    return undefined
  }
  return relativePath
}

export const PATHS = {
  INDEX: '/',
  HOME,
  LIBRARY,
  FILE: '/file',
  SETTINGS,
  SETTINGS_USER: `${SETTINGS}?tab=user` as const,
  SETTINGS_PROJECT: `${SETTINGS}?tab=project` as const,
  SETTINGS_KEYBINDINGS: `${SETTINGS}?tab=keybindings` as const,
  HOME_SETTINGS: `${HOME}${SETTINGS}` as const,
  SIGN_IN: '/signin',
  ONBOARDING: '/onboarding',
  TELEMETRY: '/telemetry',
} as const

export function getRouterSearchFromRequestUrl(
  requestUrl: string,
  usesHashRouter: boolean
): string {
  const url = new URL(requestUrl)
  if (!usesHashRouter || !url.hash) {
    return url.search
  }

  const hashPath = url.hash.slice(1)
  const searchIndex = hashPath.indexOf('?')
  if (searchIndex === -1) {
    return url.search
  }

  const hashSearch = hashPath.slice(searchIndex)
  const nestedHashIndex = hashSearch.indexOf('#')
  const routerSearch =
    nestedHashIndex === -1 ? hashSearch : hashSearch.slice(0, nestedHashIndex)

  return routerSearch === '?' ? '' : routerSearch
}

export async function getProjectMetaByRouteId(
  readAppSettingsFile: (
    wasmInstance: ModuleType
  ) => Promise<DeepPartial<Configuration>>,
  wasmInstance: ModuleType,
  id?: string,
  configuration?: DeepPartial<Configuration> | Error
): Promise<ProjectRoute | undefined> {
  if (!id) return undefined

  const isPlaywright = localStorage.getItem(IS_PLAYWRIGHT_KEY) === 'true'

  if (configuration === undefined || isPlaywright) {
    configuration = await readAppSettingsFile(wasmInstance)
  }

  if (err(configuration)) return Promise.reject(configuration)

  // Should not be possible but I guess logically it could be
  if (configuration === undefined) {
    return Promise.reject(new Error('No configuration found'))
  }

  const route = parseProjectRoute(configuration, id)

  if (err(route)) return Promise.reject(route)

  return route
}

export function parseProjectRoute(
  configuration: DeepPartial<Configuration>,
  id: string
): ProjectRoute {
  let projectName = null
  let projectPath = ''
  let currentFileName = null
  let currentFilePath = null
  const projectDirectory = getProjectDirectorySetting(configuration)
  const relativeToRoot = projectDirectory
    ? getRelativePathIfContained(projectDirectory, id)
    : undefined
  if (projectDirectory && relativeToRoot !== undefined) {
    projectName = relativeToRoot.split(fsZds.sep)[0]
    projectPath = projectName
      ? fsZds.join(projectDirectory, projectName)
      : projectDirectory
    projectName = projectName === '' ? null : projectName
  } else {
    projectPath = id
    if (fsZds.extname(id) === '.kcl') {
      projectPath = fsZds.dirname(id)
    }
    projectName = fsZds.basename(projectPath)
  }

  if (projectPath !== id) {
    currentFileName = fsZds.basename(id)
    currentFilePath = id
  }

  return {
    projectName: projectName,
    projectPath: projectPath,
    currentFileName: currentFileName,
    currentFilePath: currentFilePath,
  }
}

/**
 * Joins any number of arguments of strings to create a Router level path that is safe
 * A path will be created of the format /value/value1/value2
 * Filters out '/', ''
 * Removes all leading and ending slashes, this allows you to pass '//dog//','//cat//' it will resolve to
 * /dog/cat
 */
export function joinRouterPaths(...parts: string[]): string {
  const cleanedUpPath = webSafeJoin(
    parts
      .map((part) => part.replace(/^\/+|\/+$/g, '')) // Remove leading/trailing slashes
      .filter((part) => part.length > 0)
  ) // Remove empty segments
  return `/${cleanedUpPath}`
}

/**
 * Joins any number of arguments of strings to create a OS level path that is safe
 * A path will be created of the format /value/value1/value2
 * or \value\value1\value2 for POSIX OSes like Windows
 * Filters out the separator slashes
 * Removes all leading and ending slashes, this allows you to pass '//dog//','//cat//' it will resolve to
 * /dog/cat
 * or \dog\cat on POSIX
 */
export function joinOSPaths(...parts: string[]): string {
  const sep = fsZds.sep
  const regexSep = sep === '/' ? '/' : '\\'
  return (
    (sep === '\\' ? '' : sep) + // Windows absolute paths should not be prepended with a separator, they start with the drive name
    parts
      .map((part) =>
        part.replace(new RegExp(`^${regexSep}+|${regexSep}+$`, 'g'), '')
      ) // Remove leading/trailing slashes
      .filter((part) => part.length > 0) // Remove empty segments
      .join(sep)
  )
}

export function safeEncodeForRouterPaths(dynamicValue: string): string {
  return `${encodeURIComponent(dynamicValue)}`
}

/**
 * /dog/cat/house.kcl gives you house.kcl
 * \dog\cat\house.kcl gives you house.kcl
 * Works on all OS!
 */
export function getStringAfterLastSeparator(targetPath: string): string {
  return targetPath.split(fsZds.sep).pop() || ''
}

/**
 * When you have '/home/kevin-nadro/Documents/zoo-modeling-app-projects/bracket-1/bracket.kcl'
 * and you need to get the projectDirectory from this string above.
 *
 * We replace the leading prefix which is the application project directory with
 * the empty string. Then it becomes //bracket-1/bracket.kcl
 * The first part of the path after the blank / will be the root project directory
 *
 */
export function getProjectDirectoryFromKCLFilePath(
  targetPath: string,
  applicationProjectDirectory: string
): string {
  const relativePath = getRelativePathIfContained(
    applicationProjectDirectory,
    targetPath
  )
  if (relativePath === undefined) return ''
  return desktopSafePathSplit(relativePath)[0] ?? ''
}

export function parentPathRelativeToProject(
  absoluteFilePath: string,
  applicationProjectDirectory: string
): string {
  const relativePath = getRelativePathIfContained(
    applicationProjectDirectory,
    absoluteFilePath
  )
  if (relativePath === undefined) return ''
  const [_projectDirectory, ...rest] = desktopSafePathSplit(relativePath)
  return desktopSafePathJoin(rest)
}

export function parentPathRelativeToApplicationDirectory(
  absoluteFilePath: string,
  applicationProjectDirectory: string
): string {
  return (
    getRelativePathIfContained(applicationProjectDirectory, absoluteFilePath) ??
    ''
  )
}

export { webSafeJoin, webSafePathSplit } from '@src/lib/pathUtils'

export function toWebSafePath(targetPath: string, sep = fsZds.sep): string {
  return sep && sep !== '/' ? targetPath.replaceAll(sep, '/') : targetPath
}

export function toProjectRelativePath(
  projectPath: string,
  filePath: string
): string {
  return toWebSafePath(fsZds.relative(projectPath, filePath))
}

export function getProjectRelativeFilePath(
  project?: Project,
  file?: FileEntry
): string {
  if (!file) {
    return APP_NAME
  }

  if (project?.path && file.path) {
    const relativeFilePath = toProjectRelativePath(project.path, file.path)
    if (relativeFilePath) {
      return relativeFilePath
    }
  }

  return toWebSafePath(file.name || APP_NAME)
}

/**
 * Splits any paths safely based on the runtime
 */
export function desktopSafePathSplit(targetPath: string): string[] {
  return targetPath.split(fsZds.sep)
}

export function desktopSafePathJoin(paths: string[]): string {
  return paths.join(fsZds.sep)
}

export const getEXTNoPeriod = (filePath: string) => {
  const extension = filePath.split('.').pop() || null
  return extension
}

/**
 * Whether a file name includes a user-typed extension: a `.` that is neither the
 * first character (so dotfiles like `.gitignore` don't count) nor the last.
 * `bracket` -> false, `notes.txt` -> true, `archive.tar.gz` -> true.
 */
export const fileNameHasExtension = (fileName: string): boolean => {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 && lastDot < fileName.length - 1
}

export const getEXTWithPeriod = (filePath: string) => {
  let extension = getEXTNoPeriod(filePath)
  if (extension) {
    extension = '.' + extension
  }
  return extension
}

export const getParentAbsolutePath = (absolutePath: string) => {
  const split = desktopSafePathSplit(absolutePath)
  split.pop()
  const joined = desktopSafePathJoin(split)
  return joined
}

/**
 * Helper function to detect if an extension is an import extension
 */
export const isExtensionAnImportExtension = (
  extension: string,
  importExtensions: string[]
) => {
  return importExtensions.includes(extension.toLowerCase())
}

export const isExtensionARelevantExtension = (
  extension: string,
  relevantExtensions: string[]
) => {
  return relevantExtensions.includes(extension.toLowerCase())
}

/**
 * Given an absolute file path, remove everything
 * up to and including the project name to get
 * the path to the file relative to the project root.
 */
export function getFilePathRelativeToProject(
  absoluteFilePath: string,
  projectName: string,
  sep = fsZds.sep
) {
  // Gotcha: below we're gonna look for the index of the project name,
  // but what if the project name happens to be in the path earlier than the real one?
  // Let's put separators on either side of it and offset by one, so we know
  // it matches a whole directory name.
  const projectNameWithSeparators = sep + projectName + sep
  const projectIndexInPath = absoluteFilePath.indexOf(projectNameWithSeparators)
  // Let's leave the leading separator
  const sliceOffset = projectNameWithSeparators.length - 1

  return absoluteFilePath.slice(projectIndexInPath + sliceOffset) ?? ''
}

async function getArchiveBasePath() {
  return desktopSafePathJoin([await fsZds.getPath('userData'), ARCHIVE_DIR])
}

/** Convert any given path to an archived one.
 * The archive works by keeping the same structure as the original paths were on disk,
 * just nested within the return value of `getArchiveBasePath`,
 * so that if they are restored they can be returned to the original location.
 */
export async function toArchivePath(absolutePath: string) {
  const basePath = await getArchiveBasePath()

  // On Windows, drive names have ':' (eg C:\) but ':' is not allowed in file paths.
  // Make that make sense, right? So our archive paths need to replace that character.
  const absolutePathWithSafeDriveName = absolutePath.replace(':', '_DRIVE')
  return fsZds.join(basePath, absolutePathWithSafeDriveName)
}
