import { sep } from '@tauri-apps/api/path'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { BROWSER_FILE_NAME, BROWSER_PROJECT_NAME, FILE_EXT } from './constants'
import { isTauri } from './isTauri'

const prependRoutes =
  (routesObject: Record<string, string>) => (prepend: string) => {
    return Object.fromEntries(
      Object.entries(routesObject).map(([constName, path]) => [
        constName,
        prepend + path,
      ])
    )
  }

export const paths = {
  INDEX: '/',
  HOME: '/home',
  FILE: '/file',
  SETTINGS: '/settings',
  SIGN_IN: '/signin',
  ONBOARDING: prependRoutes(onboardingPaths)(
    '/onboarding'
  ) as typeof onboardingPaths,
} as const
export const BROWSER_PATH = `%2F${BROWSER_PROJECT_NAME}%2F${BROWSER_FILE_NAME}${FILE_EXT}`

export function getProjectMetaByRouteId(id?: string, defaultDir = '') {
  if (!id) return undefined
  const s = isTauri() ? sep() : '/'

  console.log('id', id)

  const decodedId = decodeURIComponent(id).replace(/\/$/, '') // remove trailing slash
  const projectAndFile =
    defaultDir === '/'
      ? decodedId.replace(defaultDir, '')
      : decodedId.replace(defaultDir + s, '')
  const filePathParts = projectAndFile.split(s)
  console.log('filePathParts', filePathParts)
  const projectName = filePathParts[0]
  const projectPath =
    (defaultDir === '/' ? defaultDir : defaultDir + s) + projectName
  const lastPathPart = filePathParts[filePathParts.length - 1]
  const currentFileName =
    lastPathPart === projectName ? undefined : lastPathPart
  const currentFilePath = lastPathPart === projectName ? undefined : decodedId

  return {
    projectName,
    projectPath,
    currentFileName,
    currentFilePath,
  }
}
