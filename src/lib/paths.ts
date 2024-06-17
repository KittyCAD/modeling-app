import { onboardingPaths } from 'routes/Onboarding/paths'
import { BROWSER_FILE_NAME, BROWSER_PROJECT_NAME, FILE_EXT } from './constants'
import { isTauri } from './isTauri'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { ProjectRoute } from 'wasm-lib/kcl/bindings/ProjectRoute'
import { parseProjectRoute, readAppSettingsFile } from './tauri'
import { parseProjectRoute as parseProjectRouteWasm } from 'lang/wasm'
import { readLocalStorageAppSettingsFile } from './settings/settingsUtils'

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
  [K in keyof typeof onboardingPaths]: `/onboarding${typeof onboardingPaths[K]}`
}

export const paths = {
  INDEX: '/',
  HOME: '/home',
  FILE: '/file',
  SETTINGS: '/settings',
  SIGN_IN: '/signin',
  ONBOARDING: prependRoutes(onboardingPaths)(
    '/onboarding'
  ) as OnboardingPaths,
} as const
export const BROWSER_PATH = `%2F${BROWSER_PROJECT_NAME}%2F${BROWSER_FILE_NAME}${FILE_EXT}`

export async function getProjectMetaByRouteId(
  id?: string,
  configuration?: Configuration
): Promise<ProjectRoute | undefined> {
  if (!id) return undefined

  const inTauri = isTauri()

  if (!configuration) {
    configuration = inTauri
      ? await readAppSettingsFile()
      : readLocalStorageAppSettingsFile()
  }

  const route = inTauri
    ? await parseProjectRoute(configuration, id)
    : parseProjectRouteWasm(configuration, id)

  return route
}
