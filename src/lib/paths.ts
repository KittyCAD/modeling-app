import type { PlatformPath } from 'path'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import { IS_PLAYWRIGHT_KEY } from '@src/lib/constants'

import {
  BROWSER_FILE_NAME,
  BROWSER_PROJECT_NAME,
  FILE_EXT,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { err } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'

const SETTINGS = '/settings'

export type ProjectRoute = {
  projectName: string | null
  projectPath: string
  currentFileName: string | null
  currentFilePath: string | null
}

export const PATHS = {
  INDEX: '/',
  HOME: '/home',
  FILE: '/file',
  SETTINGS,
  SETTINGS_USER: `${SETTINGS}?tab=user` as const,
  SETTINGS_PROJECT: `${SETTINGS}?tab=project` as const,
  SETTINGS_KEYBINDINGS: `${SETTINGS}?tab=keybindings` as const,
  SIGN_IN: '/signin',
  ONBOARDING: '/onboarding',
  TELEMETRY: '/telemetry',
} as const
export const BROWSER_PATH = `%2F${BROWSER_PROJECT_NAME}%2F${BROWSER_FILE_NAME}${FILE_EXT}`

export async function getProjectMetaByRouteId(
  readAppSettingsFile: () => Promise<DeepPartial<Configuration>>,
  readLocalStorageAppSettingsFile: () => DeepPartial<Configuration> | Error,
  id?: string,
  configuration?: DeepPartial<Configuration> | Error
): Promise<ProjectRoute | undefined> {
  if (!id) return undefined

  const onDesktop = isDesktop()
  const isPlaywright = localStorage.getItem(IS_PLAYWRIGHT_KEY) === 'true'

  if (configuration === undefined || isPlaywright) {
    configuration = onDesktop
      ? await readAppSettingsFile()
      : readLocalStorageAppSettingsFile()
  }

  if (err(configuration)) return Promise.reject(configuration)

  // Should not be possible but I guess logically it could be
  if (configuration === undefined) {
    return Promise.reject(new Error('No configuration found'))
  }

  const route = parseProjectRoute(configuration, id, window?.electron?.path)

  if (err(route)) return Promise.reject(route)

  return route
}

export function parseProjectRoute(
  configuration: DeepPartial<Configuration>,
  id: string,
  pathlib: PlatformPath | undefined
): ProjectRoute {
  let projectName = null
  let projectPath = ''
  let currentFileName = null
  let currentFilePath = null
  if (
    pathlib &&
    configuration.settings?.project?.directory &&
    id.startsWith(configuration.settings.project.directory)
  ) {
    const relativeToRoot = pathlib.relative(
      configuration.settings.project.directory,
      id
    )
    projectName = relativeToRoot.split(pathlib.sep)[0]
    projectPath = pathlib.join(
      configuration.settings.project.directory,
      projectName
    )
    projectName = projectName === '' ? null : projectName
  } else {
    projectPath = id
    if (pathlib) {
      if (pathlib.extname(id) === '.kcl') {
        projectPath = pathlib.dirname(id)
      }
      projectName = pathlib.basename(projectPath)
    } else {
      if (id.endsWith('.kcl')) {
        projectPath = '/browser'
        projectName = 'browser'
      }
    }
  }
  if (pathlib) {
    if (projectPath !== id) {
      currentFileName = pathlib.basename(id)
      currentFilePath = id
    }
  } else {
    currentFileName = 'main.kcl'
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
  const sep = window.electron?.sep || '/'
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
export function getStringAfterLastSeparator(path: string): string {
  return path.split(window.electron.sep).pop() || ''
}

/**
 * When you have an encodedURIComponent then you decode the URI component this can help split the path safely
 * assumes /file/<encodedURIComponent>
 * e.g '/file/%2Fhome%2Fkevin-nadro%2FDocuments%2Fzoo-modeling-app-projects%2Fbracket-1%2Fbracket.kcl'
 */
export function getProjectDirectoryFromKCLFilePath(
  path: string,
  applicationProjectDirectory: string
): string {
  // /myCoolProject/subDir/cool.kcl
  const replacedPath = path.replace(applicationProjectDirectory, '')
  const [iAmABlankString, projectDirectory] = desktopSafePathSplit(replacedPath)
  return projectDirectory
}

/**
 * Use this for only web related paths not paths in OS or on disk
 * e.g. document.location.pathname
 */
export function webSafePathSplit(path: string): string[] {
  const webSafeSep = '/'
  return path.split(webSafeSep)
}

export function webSafeJoin(paths: string[]): string {
  const webSafeSep = '/'
  return paths.join(webSafeSep)
}

/**
 * Splits any paths safely based on the runtime
 */
export function desktopSafePathSplit(path: string): string[] {
  return isDesktop()
    ? path.split(window?.electron?.sep)
    : webSafePathSplit(path)
}

export function desktopSafePathJoin(paths: string[]): string {
  return isDesktop() ? paths.join(window?.electron?.sep) : webSafeJoin(paths)
}
