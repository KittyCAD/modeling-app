import { signal } from '@preact/signals-core'

export type ProjectLibraryRealizationsInvalidationInput = {
  libraryId?: string
}

export type ProjectLibraryRealizationsInvalidationSnapshot = {
  global: number
  byLibraryId: ReadonlyMap<string, number>
}

const projectLibraryRealizationsInvalidation =
  signal<ProjectLibraryRealizationsInvalidationSnapshot>({
    global: 0,
    byLibraryId: new Map(),
  })

/**
 * Marks configured local realization discovery stale. A library-scoped
 * invalidation lets filesystem watchers and project-library operations refresh
 * only the library whose concrete folders changed.
 */
export function invalidateProjectLibraryRealizations(
  input: ProjectLibraryRealizationsInvalidationInput = {}
) {
  const current = projectLibraryRealizationsInvalidation.value
  if (!input.libraryId) {
    projectLibraryRealizationsInvalidation.value = {
      global: current.global + 1,
      byLibraryId: current.byLibraryId,
    }
    return
  }

  const byLibraryId = new Map(current.byLibraryId)
  byLibraryId.set(input.libraryId, (byLibraryId.get(input.libraryId) ?? 0) + 1)
  projectLibraryRealizationsInvalidation.value = {
    global: current.global,
    byLibraryId,
  }
}

/** Returns the current invalidation generation snapshot for discovery effects. */
export function readProjectLibraryRealizationsInvalidation() {
  return projectLibraryRealizationsInvalidation.value
}

/** Returns the generation number relevant to one configured library. */
export function readProjectLibraryRealizationInvalidationForLibrary(
  snapshot: ProjectLibraryRealizationsInvalidationSnapshot,
  libraryId: string
) {
  return {
    global: snapshot.global,
    library: snapshot.byLibraryId.get(libraryId) ?? 0,
  }
}
