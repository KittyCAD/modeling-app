import { isArray } from '@src/lib/utils'

export const DEFAULT_PROJECT_LIBRARY_ID = 'default-project-directory'
export const CLOUD_PROJECT_LIBRARY_ID = 'cloud'

export type ProjectLibraryType =
  | 'directory'
  | 'recents'
  | 'cloud'
  | (string & {})

export interface ProjectLibrarySetting {
  title: string
  path: string
  type: ProjectLibraryType
}

export interface ProjectLibrary extends ProjectLibrarySetting {
  id: string
  icon?: string
  order?: number
}

function hashString(input: string) {
  let hash = 0

  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }

  return Math.abs(hash).toString(36)
}

export function getProjectLibraryIdFromSetting(library: ProjectLibrarySetting) {
  return `${library.type}-${hashString(
    `${library.type}:${library.path}:${library.title}`
  )}`
}

export function isProjectLibrarySetting(
  value: unknown
): value is ProjectLibrarySetting {
  if (!value || typeof value !== 'object' || isArray(value)) {
    return false
  }

  const library = value as Record<string, unknown>
  return (
    typeof library.title === 'string' &&
    library.title.length > 0 &&
    typeof library.path === 'string' &&
    library.path.length > 0 &&
    typeof library.type === 'string' &&
    library.type.length > 0
  )
}

export function isProjectLibrarySettings(
  value: unknown
): value is ProjectLibrarySetting[] {
  return isArray(value) && value.every(isProjectLibrarySetting)
}

export function projectLibraryFromSetting(
  library: ProjectLibrarySetting,
  index = 0
): ProjectLibrary {
  return {
    ...library,
    id: getProjectLibraryIdFromSetting(library),
    order: index,
  }
}
