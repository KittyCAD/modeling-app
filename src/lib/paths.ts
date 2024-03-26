import { sep } from '@tauri-apps/api/path'
import { onboardingPaths } from 'routes/Onboarding/paths'

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
}

export function getProjectMetaByRouteId(id?: string, defaultDir = '') {
  if (!id) return undefined

  const decodedId = decodeURIComponent(id).replace(/\/$/g, '') // remove trailing slash
  const projectAndFile = decodedId.replace(defaultDir + sep, '')
  const filePathParts = projectAndFile.split(sep)
  const projectName = filePathParts[0]
  const projectPath = defaultDir + sep + projectName
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
