import { onboardingPaths } from 'routes/Onboarding/paths'
import { BROWSER_FILE_NAME, BROWSER_PROJECT_NAME, FILE_EXT } from './constants'
import { isDesktop } from './isDesktop'
import { readAppSettingsFile } from './desktop'
import { readLocalStorageAppSettingsFile } from './settings/settingsUtils'
import { err } from 'lib/trap'
import { IS_PLAYWRIGHT_KEY } from '../../e2e/playwright/storageStates'
import { DeepPartial } from './types'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'

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

const SETTINGS = '/settings' as const

export type ProjectRoute = {
  projectName: string
  projectPath: string
  currentFileName: string
  currentFilePath: string
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

  const route = parseProjectRoute(configuration, id)

  if (err(route)) return Promise.reject(route)

  return route
}

const parseProjectRoute = (
  configuration: Partial<SaveSettingsPayload>,
  id: string
) => {
  let projectName = ''
  let projectPath = ''
  if (
    configuration.app?.projectDirectory &&
    id.startsWith(configuration.app.projectDirectory)
  ) {
    const relativeToRoot = window.electron.path.relative(
      configuration.app.projectDirectory,
      id
    )
    projectName = relativeToRoot.split(window.electron.path.sep)[0]
    projectPath = window.electron.path.join(
      configuration.app.projectDirectory,
      projectName
    )
  } else {
  }
  return {
    projectName: projectName,
    projectPath: projectPath,
    currentFileName: window.electron.path.basename(id),
    currentFilePath: id,
  }
}
