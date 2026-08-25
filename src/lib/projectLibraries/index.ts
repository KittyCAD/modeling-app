import { PROJECT_FOLDER } from '@src/lib/constants'
import { hashString } from '@src/lib/stringUtils'
import { isArray } from '@src/lib/utils'

export const DEFAULT_PROJECT_LIBRARY_ID = 'default-project-directory'
export const DEFAULT_PROJECT_LIBRARY_TITLE = 'Local Projects'
export const NEW_PROJECT_LIBRARY_TITLE = 'Project Library'
export const DIRECTORY_PROJECT_LIBRARY_TYPE = 'directory'
export const PERSONAL_CLOUD_PROJECT_LIBRARY_ID = 'cloud-personal'
export const PERSONAL_CLOUD_PROJECT_LIBRARY_TITLE = 'Personal Cloud'
export const CLOUD_PROJECT_LIBRARY_TYPE = 'cloud'
export const LEGACY_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH = '/personal'
export const DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH = `/documents/${PROJECT_FOLDER}`
export const CLOUD_PROJECT_LIBRARY_PATH_DISPLAY_PREFIX = 'zoo://'

export function formatProjectLibraryPathForDisplay(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'>
) {
  if (library.type !== CLOUD_PROJECT_LIBRARY_TYPE) {
    return library.path
  }

  const cloudSource =
    library.source?.trim() || LEGACY_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH
  return `${CLOUD_PROJECT_LIBRARY_PATH_DISPLAY_PREFIX}${cloudSource.replace(/^\/+/, '')}`
}

export function getProjectLibrarySummaryDescription(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'>
) {
  if (library.type === CLOUD_PROJECT_LIBRARY_TYPE) {
    return 'Projects in this library sync to your Zoo account'
  }

  if (library.type === DIRECTORY_PROJECT_LIBRARY_TYPE) {
    return 'Projects in this library are saved only on this computer'
  }

  return formatProjectLibraryPathForDisplay(library)
}

export function getProjectLibraryDetailsDescription(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'>
) {
  if (library.type === CLOUD_PROJECT_LIBRARY_TYPE) {
    return [
      'Projects in this library sync to your Zoo account.',
      'Storage type and model-training controls depend on your plan.',
    ].join(' ')
  }

  if (library.type === DIRECTORY_PROJECT_LIBRARY_TYPE) {
    return 'Projects in this library are saved only on this computer.'
  }

  return undefined
}

export function getProjectLibraryLocationLabel(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'>
) {
  if (library.type === CLOUD_PROJECT_LIBRARY_TYPE) {
    return 'Technical source'
  }

  if (library.type === DIRECTORY_PROJECT_LIBRARY_TYPE) {
    return 'Folder'
  }

  return 'Location'
}

export function getProjectLibrarySummaryTooltip(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'>
) {
  const description = getProjectLibraryDetailsDescription(library)
  const locationLabel = getProjectLibraryLocationLabel(library)
  const technicalLocation = formatProjectLibraryPathForDisplay(library)

  if (description) {
    return `${description} ${locationLabel}: ${technicalLocation}`
  }

  return technicalLocation
}

export type ProjectLibraryType = string

export interface ProjectLibrarySetting {
  title: string
  path: string
  type: ProjectLibraryType
  source?: string
}

export interface ProjectLibrary extends ProjectLibrarySetting {
  id: string
  icon?: string
  order?: number
}

export interface ProjectLibraryInitialProject {
  files: readonly {
    requestedFileName: string
    requestedData: Uint8Array<ArrayBuffer>
  }[]
  entrypointFilePath: string
}

export type SerializedProjectLibrarySetting = Omit<
  ProjectLibrarySetting,
  'path'
> & {
  path?: string
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

export function getDefaultCloudProjectLibrarySetting(
  localMaterializationPath = DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH
): ProjectLibrarySetting {
  return {
    title: PERSONAL_CLOUD_PROJECT_LIBRARY_TITLE,
    path: localMaterializationPath,
    type: CLOUD_PROJECT_LIBRARY_TYPE,
  }
}

export function canRemoveProjectLibrary(
  library: Pick<ProjectLibrarySetting, 'type'>,
  options: { canManageLibraries: boolean }
) {
  if (library.type === CLOUD_PROJECT_LIBRARY_TYPE) {
    return false
  }

  return (
    options.canManageLibraries ||
    library.type === DIRECTORY_PROJECT_LIBRARY_TYPE
  )
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

export function normalizeLibraryPath(path: string) {
  return path.replaceAll('\\', '/').replace(/\/+$/g, '')
}

function isDefaultPersonalCloudProjectLibraryPath(path: string | undefined) {
  const normalizedPath = normalizeLibraryPath(path ?? '')
  return (
    normalizedPath ===
      normalizeLibraryPath(LEGACY_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH) ||
    normalizedPath ===
      normalizeLibraryPath(DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH)
  )
}

export function isLegacyPersonalCloudProjectLibraryPathSetting(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'>
) {
  return (
    library.type === CLOUD_PROJECT_LIBRARY_TYPE &&
    !library.source?.trim() &&
    normalizeLibraryPath(library.path) ===
      normalizeLibraryPath(LEGACY_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH)
  )
}

export function isDefaultPersonalCloudProjectLibraryPathSetting(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'>
) {
  return (
    library.type === CLOUD_PROJECT_LIBRARY_TYPE &&
    !library.source?.trim() &&
    isDefaultPersonalCloudProjectLibraryPath(library.path)
  )
}

export function isPersonalCloudProjectLibrarySetting(
  library: Pick<ProjectLibrarySetting, 'path' | 'source' | 'type'>
) {
  return library.type === CLOUD_PROJECT_LIBRARY_TYPE && !library.source?.trim()
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
  const source = library.source?.trim() || fallback.source?.trim()
  const type = library.type || fallback.type
  const path = library.path.trim() || fallback.path
  const normalizedPath =
    type === CLOUD_PROJECT_LIBRARY_TYPE &&
    !source &&
    isDefaultPersonalCloudProjectLibraryPath(path)
      ? fallback.path
      : path

  return {
    title: library.title.trim() || fallback.title,
    path: normalizedPath,
    type,
    ...(source ? { source } : {}),
  }
}

export function projectLibrarySettingsFromSerialized(
  value: unknown
): ProjectLibrarySetting[] | undefined {
  if (!isArray(value)) {
    return undefined
  }

  const libraries = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || isArray(entry)) {
      return undefined
    }

    const library = entry as Record<string, unknown>
    if (
      typeof library.title !== 'string' ||
      library.title.length === 0 ||
      typeof library.type !== 'string' ||
      library.type.length === 0 ||
      (Object.hasOwn(library, 'path') && typeof library.path !== 'string') ||
      (Object.hasOwn(library, 'source') && typeof library.source !== 'string')
    ) {
      return undefined
    }

    const sourceValue =
      typeof library.source === 'string' ? library.source.trim() : ''
    const source = sourceValue ? { source: sourceValue } : {}
    const path = typeof library.path === 'string' ? library.path : ''

    if (
      (library.type !== CLOUD_PROJECT_LIBRARY_TYPE || sourceValue) &&
      !path.trim()
    ) {
      return undefined
    }

    return normalizeProjectLibrarySetting(
      {
        title: library.title,
        path,
        type: library.type,
        ...source,
      },
      library.type === CLOUD_PROJECT_LIBRARY_TYPE
        ? getDefaultCloudProjectLibrarySetting()
        : {
            title: library.title,
            path,
            type: library.type,
            ...source,
          }
    )
  })

  return libraries.every(isProjectLibrarySetting) ? libraries : undefined
}

export function projectLibrarySettingsToSerialized(
  libraries: readonly ProjectLibrarySetting[]
): SerializedProjectLibrarySetting[] {
  return libraries.map((library) => {
    const source = library.source?.trim()
    const path = library.path.trim()
    return {
      title: library.title,
      type: library.type,
      ...(isDefaultPersonalCloudProjectLibraryPathSetting(library)
        ? {}
        : { path }),
      ...(source ? { source } : {}),
    }
  })
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
        library.type === otherLibrary.type &&
        (library.source ?? '') === (otherLibrary.source ?? '')
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
  return `${library.type}-${hashString(
    `${library.type}:${library.path}:${library.source ?? ''}`
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
    library.type.length > 0 &&
    (!Object.hasOwn(library, 'source') || typeof library.source === 'string')
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
        : isPersonalCloudProjectLibrarySetting(library)
          ? PERSONAL_CLOUD_PROJECT_LIBRARY_ID
          : getProjectLibraryIdFromSetting(library),
    order: index,
  }
}

export function projectLibrariesFromSettings(
  libraries: readonly ProjectLibrarySetting[]
): ProjectLibrary[] {
  const defaultProjectDirectory =
    getDefaultDirectoryProjectLibraryPath(libraries)
  return libraries.map((library, index) =>
    projectLibraryFromSetting(library, index, {
      defaultProjectDirectory,
    })
  )
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
