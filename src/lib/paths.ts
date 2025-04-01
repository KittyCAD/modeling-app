import { err } from 'lib/trap'
import { PlatformPath } from 'path'
import { onboardingPaths } from 'routes/Onboarding/paths'

import { Configuration } from '@rust/kcl-lib/bindings/Configuration'

import { IS_PLAYWRIGHT_KEY } from '../../e2e/playwright/storageStates'
import { BROWSER_FILE_NAME, BROWSER_PROJECT_NAME, FILE_EXT } from './constants'
import { readAppSettingsFile } from './desktop'
import { isDesktop } from './isDesktop'
import { readLocalStorageAppSettingsFile } from './settings/settingsUtils'
import { DeepPartial } from './types'

const prependRoutes =
  (routesObject: Record<string, string>) => (prepend: string) => {
    return Object.fromEntries(
      Object.entries(routesObject).map(([constName, path]) => [
        constName,
        prepend + path,
      ])
    )
  }

type OnboardingPaths = {
  [K in keyof typeof onboardingPaths]: `/onboarding${(typeof onboardingPaths)[K]}`
}

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
  ONBOARDING: prependRoutes(onboardingPaths)('/onboarding') as OnboardingPaths,
  TELEMETRY: '/telemetry',
} as const
export const BROWSER_PATH = `%2F${BROWSER_PROJECT_NAME}%2F${BROWSER_FILE_NAME}${FILE_EXT}`

export async function getProjectMetaByRouteId(
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
