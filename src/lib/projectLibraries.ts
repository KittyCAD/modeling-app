/**
 * Project libraries: value logic, no I/O and no registry.
 *
 * A *library* is a configured place projects live. A library *type* is the kind
 * of place it is — a directory today; cloud and network shares are the reason
 * the type is an open string rather than a union.
 *
 * Keeping this module pure is what lets settings validation, id derivation, and
 * realization merging be tested directly, since all three have edge cases that
 * are miserable to reach through UI.
 */

import { hashString } from '@src/lib/hash'
import { isPathInside, normalizePath } from '@src/lib/paths'

export type ProjectLibraryType = string

export const DIRECTORY_LIBRARY_TYPE = 'directory'
export const DEFAULT_LIBRARY_ID = 'default-project-directory'
export const DEFAULT_LIBRARY_TITLE = 'Local Projects'
export const NEW_LIBRARY_TITLE = 'Project Library'

/** What the user configured. This is what gets persisted. */
export interface ProjectLibrarySetting {
  title: string
  path: string
  type: ProjectLibraryType
  /**
   * Type-specific addressing for libraries not identified by their path — a
   * cloud org, a remote host. Unused by `directory`, and part of a library's
   * identity so two libraries can share a local path with different sources.
   */
  source?: string
}

/** A setting resolved into something addressable. */
export interface ProjectLibrary extends ProjectLibrarySetting {
  id: string
  /** Position in the configured list. Drives display order. */
  order: number
}

/**
 * One concrete project folder, discovered through one or more libraries.
 *
 * Identity is the folder path, not the library, because overlapping library
 * paths must not produce two cards for the same project on disk. The same
 * realization simply reports membership in several libraries.
 */
export interface ProjectLibraryRealization {
  /** `local:<normalized path>`. */
  id: string
  libraryIds: readonly string[]
  path: string
  /** The folder name on disk. */
  name: string
  /** A human title, when the project records one. Falls back to `name`. */
  title?: string
  modifiedAt: number
  fileCount: number
  kclFileCount: number
  directoryCount: number
  readWriteAccess: boolean
  /** Which file to open first, when the project nominates one. */
  defaultFile?: string
}

/** What a library type returns from discovery, before merging. */
export type ProjectLibraryRealizationContribution = Omit<
  ProjectLibraryRealization,
  'id' | 'libraryIds'
> & {
  id?: string
  libraryId?: string
  libraryIds?: readonly string[]
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function libraryIdFromSetting(setting: ProjectLibrarySetting): string {
  return `${setting.type}-${hashString(
    `${setting.type}:${normalizePath(setting.path)}:${setting.source ?? ''}`
  )}`
}

/**
 * Resolve settings into libraries.
 *
 * The first directory library at the default root keeps a fixed id, so the URL
 * of someone's main library does not change when they add another one before it.
 */
export function librariesFromSettings(
  settings: readonly ProjectLibrarySetting[],
  options: { defaultRoot?: string } = {}
): ProjectLibrary[] {
  const defaultRoot = options.defaultRoot
    ? normalizePath(options.defaultRoot)
    : undefined
  let defaultAssigned = false

  return settings.map((setting, order) => {
    const isDefault =
      !defaultAssigned &&
      setting.type === DIRECTORY_LIBRARY_TYPE &&
      defaultRoot !== undefined &&
      normalizePath(setting.path) === defaultRoot

    if (isDefault) defaultAssigned = true

    return {
      ...setting,
      id: isDefault ? DEFAULT_LIBRARY_ID : libraryIdFromSetting(setting),
      order,
    }
  })
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function isProjectLibrarySetting(
  value: unknown
): value is ProjectLibrarySetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.title === 'string' &&
    candidate.title.trim().length > 0 &&
    typeof candidate.path === 'string' &&
    candidate.path.trim().length > 0 &&
    typeof candidate.type === 'string' &&
    candidate.type.length > 0 &&
    (!Object.hasOwn(candidate, 'source') ||
      typeof candidate.source === 'string')
  )
}

/**
 * Parse persisted settings, discarding anything malformed.
 *
 * Returns only the entries that survive rather than failing the whole list: one
 * bad entry written by an older build should cost that library, not every
 * library the user has.
 */
export function parseProjectLibrarySettings(
  value: unknown
): ProjectLibrarySetting[] {
  if (!Array.isArray(value)) return []

  return value.filter(isProjectLibrarySetting).map((setting) => ({
    title: setting.title.trim(),
    path: normalizePath(setting.path.trim()),
    type: setting.type,
    ...(setting.source?.trim() ? { source: setting.source.trim() } : {}),
  }))
}

/**
 * Merge library lists, keyed by type, path, and source.
 *
 * Later entries win on a collision, so defaults contributed by a feature can be
 * overridden by what the user configured without duplicating the row.
 */
export function mergeProjectLibrarySettings(
  ...groups: readonly (readonly ProjectLibrarySetting[] | undefined)[]
): ProjectLibrarySetting[] {
  const byKey = new Map<string, ProjectLibrarySetting>()

  for (const setting of groups.flatMap((group) => group ?? [])) {
    const key = `${setting.type}:${normalizePath(setting.path)}:${setting.source ?? ''}`
    byKey.set(key, { ...byKey.get(key), ...setting })
  }

  return Array.from(byKey.values())
}

export function moveProjectLibrarySetting(
  settings: readonly ProjectLibrarySetting[],
  fromIndex: number,
  toIndex: number
): ProjectLibrarySetting[] {
  const next = [...settings]
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= next.length ||
    toIndex >= next.length
  ) {
    return next
  }

  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

// ---------------------------------------------------------------------------
// Realizations
// ---------------------------------------------------------------------------

export function realizationId(path: string): string {
  return `local:${normalizePath(path)}`
}

/**
 * Combine discovery results by folder path.
 *
 * Two libraries whose paths overlap see the same folder; that must be one
 * realization belonging to both, not two competing entries. Later contributions
 * win on the descriptive fields, since a library that scanned more deeply knows
 * more.
 */
export function combineRealizations(
  contributions: readonly ProjectLibraryRealizationContribution[]
): ProjectLibraryRealization[] {
  const byPath = new Map<string, ProjectLibraryRealization>()

  for (const contribution of contributions) {
    const path = normalizePath(contribution.path)
    const libraryIds = Array.from(
      new Set(
        [contribution.libraryId, ...(contribution.libraryIds ?? [])].filter(
          (id): id is string => Boolean(id)
        )
      )
    )

    const existing = byPath.get(path)
    const {
      libraryId: _libraryId,
      libraryIds: _libraryIds,
      id,
      ...rest
    } = contribution

    byPath.set(path, {
      ...existing,
      ...rest,
      path,
      id: id ?? realizationId(path),
      libraryIds: Array.from(
        new Set([...(existing?.libraryIds ?? []), ...libraryIds])
      ),
    })
  }

  return Array.from(byPath.values())
}

export function realizationsForLibrary(
  realizations: readonly ProjectLibraryRealization[],
  libraryId: string
): ProjectLibraryRealization[] {
  return realizations.filter((realization) =>
    realization.libraryIds.includes(libraryId)
  )
}

/**
 * The library that most specifically contains a path.
 *
 * Deepest path wins, so a library nested inside another owns its own projects
 * rather than the outer one claiming them.
 */
export function containingLibrary(
  libraries: readonly ProjectLibrary[],
  path: string
): ProjectLibrary | undefined {
  return libraries
    .filter((library) => library.type === DIRECTORY_LIBRARY_TYPE)
    .filter((library) => isPathInside(library.path, path))
    .toSorted(
      (a, b) => normalizePath(b.path).length - normalizePath(a.path).length
    )
    .at(0)
}
