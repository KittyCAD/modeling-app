import { onboardingPaths } from 'routes/Onboarding/paths'
import { BROWSER_FILE_NAME, BROWSER_PROJECT_NAME, FILE_EXT } from './constants'
import { isDesktop } from './isDesktop'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { ProjectRoute } from 'wasm-lib/kcl/bindings/ProjectRoute'
import { parseProjectRoute, readAppSettingsFile } from './desktop'
import { readLocalStorageAppSettingsFile } from './settings/settingsUtils'
import { err } from 'lib/trap'

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

export const paths = {
  INDEX: '/',
  HOME: '/home',
  FILE: '/file',
  SETTINGS: '/settings',
  SIGN_IN: '/signin',
  ONBOARDING: prependRoutes(onboardingPaths)('/onboarding') as OnboardingPaths,
} as const
export const BROWSER_PATH = `%2F${BROWSER_PROJECT_NAME}%2F${BROWSER_FILE_NAME}${FILE_EXT}`

export async function getProjectMetaByRouteId(
  id?: string,
  configuration?: Configuration | Error
): Promise<ProjectRoute | undefined> {
  if (!id) return undefined

  const onDesktop = isDesktop()

  if (configuration === undefined) {
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
