import { hashString } from '@src/lib/stringUtils'
import { isArray } from '@src/lib/utils'

export const DEFAULT_PROJECT_LIBRARY_ID = 'default-project-directory'
export const DEFAULT_PROJECT_LIBRARY_TITLE = 'Default Projects Directory'
export const NEW_PROJECT_LIBRARY_TITLE = 'Project Library'
export const DIRECTORY_PROJECT_LIBRARY_TYPE = 'directory'
export const CLOUD_PROJECT_LIBRARY_ID = 'cloud'
export const CLOUD_PROJECT_LIBRARY_TITLE = 'Cloud'
export const CLOUD_PROJECT_LIBRARY_TYPE = 'cloud'
export const DEFAULT_CLOUD_PROJECT_LIBRARY_PATH = 'zoo://user/projects'

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

export function getDefaultCloudProjectLibrarySetting(): ProjectLibrarySetting {
  return {
    title: CLOUD_PROJECT_LIBRARY_TITLE,
    path: DEFAULT_CLOUD_PROJECT_LIBRARY_PATH,
    type: CLOUD_PROJECT_LIBRARY_TYPE,
  }
}

export function getDefaultDirectoryProjectLibrarySetting(
  libraries: readonly ProjectLibrarySetting[] | undefined
) {
  return libraries?.find(
    (library) => library.type === DIRECTORY_PROJECT_LIBRARY_TYPE
  )
}

export function getDefaultDirectoryProjectLibraryPath(
  libraries: readonly ProjectLibrarySetting[] | undefined
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

export function normalizeProjectLibrarySetting(
  library: ProjectLibrarySetting,
  fallback: ProjectLibrarySetting
): ProjectLibrarySetting {
  return {
    title: library.title.trim() || fallback.title,
    path: library.path.trim() || fallback.path,
    type: library.type || fallback.type,
  }
}

export function updateProjectLibrarySettingAt(
  libraries: readonly ProjectLibrarySetting[],
  index: number,
  update: (library: ProjectLibrarySetting) => ProjectLibrarySetting
): ProjectLibrarySetting[] {
  return libraries.map((library, currentIndex) =>
    currentIndex === index ? update(library) : library
  )
}

export function areProjectLibrarySettingsEqual(
  left: readonly ProjectLibrarySetting[],
  right: readonly ProjectLibrarySetting[]
) {
  return (
    left.length === right.length &&
    left.every((library, index) => {
      const otherLibrary = right[index]
      return (
        otherLibrary !== undefined &&
        library.title === otherLibrary.title &&
        library.path === otherLibrary.path &&
        library.type === otherLibrary.type
      )
    })
  )
}

export function moveProjectLibrarySetting(
  libraries: readonly ProjectLibrarySetting[],
  fromIndex: number,
  toIndex: number
): ProjectLibrarySetting[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= libraries.length ||
    toIndex >= libraries.length
  ) {
    return [...libraries]
  }

  const nextLibraries = [...libraries]
  const [library] = nextLibraries.splice(fromIndex, 1)
  if (!library) {
    return [...libraries]
  }

  nextLibraries.splice(toIndex, 0, library)
  return nextLibraries
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
        : library.type === CLOUD_PROJECT_LIBRARY_TYPE &&
            library.path === DEFAULT_CLOUD_PROJECT_LIBRARY_PATH
          ? CLOUD_PROJECT_LIBRARY_ID
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
