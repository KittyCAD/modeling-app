import { isArray } from '@src/lib/utils'

export const DEFAULT_PROJECT_LIBRARY_ID = 'default-project-directory'
export const DEFAULT_PROJECT_LIBRARY_TITLE = 'Default Projects Directory'
export const DIRECTORY_PROJECT_LIBRARY_TYPE = 'directory'

export type ProjectLibraryType = string

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

export function getDefaultProjectLibrarySettings(
  projectDirectory: string
): ProjectLibrarySetting[] {
  return [
    {
      title: DEFAULT_PROJECT_LIBRARY_TITLE,
      path: projectDirectory,
      type: DIRECTORY_PROJECT_LIBRARY_TYPE,
    },
  ]
}

export function getDefaultDirectoryProjectLibrarySetting(
  libraries: readonly ProjectLibrarySetting[]
) {
  return libraries.find(
    (library) => library.type === DIRECTORY_PROJECT_LIBRARY_TYPE
  )
}

export function getDefaultDirectoryProjectLibraryPath(
  libraries: readonly ProjectLibrarySetting[]
) {
  return getDefaultDirectoryProjectLibrarySetting(libraries)?.path
}

function normalizeLibraryPath(path: string) {
  return path.replaceAll('\\', '/').replace(/\/+$/g, '')
}

export function isPathInDirectoryProjectLibrary(
  targetPath: string,
  libraryPath: string
) {
  const normalizedTargetPath = normalizeLibraryPath(targetPath)
  const normalizedLibraryPath = normalizeLibraryPath(libraryPath)

  if (!normalizedLibraryPath) {
    return false
  }

  return (
    normalizedTargetPath === normalizedLibraryPath ||
    normalizedTargetPath.startsWith(`${normalizedLibraryPath}/`)
  )
}

export function getContainingDirectoryProjectLibraryPath(
  libraries: readonly ProjectLibrarySetting[],
  projectPath: string
) {
  return libraries
    .filter((library) => library.type === DIRECTORY_PROJECT_LIBRARY_TYPE)
    .filter((library) =>
      isPathInDirectoryProjectLibrary(projectPath, library.path)
    )
    .toSorted((a, b) => b.path.length - a.path.length)
    .at(0)?.path
}

export function mergeProjectLibrarySettings(
  ...libraryGroups: readonly (readonly ProjectLibrarySetting[] | undefined)[]
) {
  const librariesByKey = new Map<string, ProjectLibrarySetting>()

  for (const library of libraryGroups.flatMap((libraries) => libraries ?? [])) {
    librariesByKey.set(`${library.type}:${library.path}`, {
      ...librariesByKey.get(`${library.type}:${library.path}`),
      ...library,
    })
  }

  return Array.from(librariesByKey.values())
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
  return `${library.type}-${hashString(`${library.type}:${library.path}`)}`
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
  index = 0,
  options: {
    defaultProjectDirectory?: string
  } = {}
): ProjectLibrary {
  return {
    ...library,
    id:
      library.type === DIRECTORY_PROJECT_LIBRARY_TYPE &&
      library.path === options.defaultProjectDirectory
        ? DEFAULT_PROJECT_LIBRARY_ID
        : getProjectLibraryIdFromSetting(library),
    order: index,
  }
}

export function updateDefaultDirectoryProjectLibrarySetting(
  libraries: readonly ProjectLibrarySetting[],
  updates: Partial<Pick<ProjectLibrarySetting, 'title' | 'path'>>
): ProjectLibrarySetting[] {
  const defaultDirectoryLibrary =
    getDefaultDirectoryProjectLibrarySetting(libraries)

  if (!defaultDirectoryLibrary) {
    return [...libraries]
  }

  return libraries.map((library) =>
    library === defaultDirectoryLibrary
      ? {
          ...library,
          ...updates,
        }
      : library
  )
}
