import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { FileSystem } from '@src/contracts/fileSystem'
import type {
  LibraryLoadState,
  ProjectLibrariesService,
  ProjectLibraryTypeContribution,
} from '@src/contracts/projectLibraries'
import { resolveLibraryDefaults } from '@src/contracts/projectLibraries'
import { isPathInside, normalizePath } from '@src/lib/paths'
import {
  type ProjectLibrary,
  type ProjectLibraryRealization,
  type ProjectLibraryRealizationContribution,
  type ProjectLibrarySetting,
  type ProjectLibraryType,
  combineRealizations,
  librariesFromSettings,
  mergeProjectLibrarySettings,
  moveProjectLibrarySetting,
  parseProjectLibrarySettings,
  realizationsForLibrary,
} from '@src/lib/projectLibraries'

const STORAGE_KEY = 'zds.libraries'

type TypeMap = ReadonlyMap<ProjectLibraryType, ProjectLibraryTypeContribution>

function readStoredSettings(): ProjectLibrarySetting[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseProjectLibrarySettings(JSON.parse(raw)) : []
  } catch {
    // A malformed list falls back to the contributed defaults rather than
    // leaving the user with no libraries at all.
    return []
  }
}

/**
 * Owns which libraries exist and what is in them.
 *
 * Two responsibilities that are deliberately separate: *configuration* (the
 * settings list, persisted, user-ordered) and *discovery* (what each library
 * currently contains). Discovery results are kept per library so refreshing one
 * library does not discard what is known about the others — which is what makes
 * a filesystem change in one folder cheap to reflect.
 *
 * Every project operation is routed to the owning library's type. This service
 * knows nothing about directories, and will need no changes to gain cloud
 * libraries.
 */
export function createProjectLibrariesService(
  fileSystem: FileSystem,
  typesSignal: ReadonlySignal<TypeMap>,
  defaultsSignal: ReadonlySignal<
    readonly ((input: {
      defaultRoot: string
    }) => readonly ProjectLibrarySetting[])[]
  >
): ProjectLibrariesService & { dispose: () => void } {
  const stored = signal<readonly ProjectLibrarySetting[]>(readStoredSettings())
  const seeded = signal(stored.value.length > 0)
  const state = signal<LibraryLoadState>('idle')
  const error = signal<string | null>(null)

  /** Discovery results, keyed by the library that produced them. */
  const discovered = signal<
    ReadonlyMap<string, readonly ProjectLibraryRealizationContribution[]>
  >(new Map())

  let scanController: AbortController | null = null

  const persist = (settings: readonly ProjectLibrarySetting[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (caught) {
      console.warn('projectLibraries: could not persist settings', caught)
    }
  }

  /**
   * Settings, seeded from contributed defaults on first use.
   *
   * Seeding is deferred until the filesystem reports a default root, because on
   * desktop that arrives asynchronously and a library seeded at the wrong root
   * would persist the mistake.
   */
  const settings = computed<readonly ProjectLibrarySetting[]>(() => {
    if (seeded.value) return stored.value

    const defaultRoot = fileSystem.defaultRoot.value
    if (!defaultRoot) return []

    return resolveLibraryDefaults(defaultsSignal.value, defaultRoot)
  })

  const libraries = computed<readonly ProjectLibrary[]>(() =>
    librariesFromSettings(settings.value, {
      defaultRoot: fileSystem.defaultRoot.value,
    })
  )

  const realizations = computed<readonly ProjectLibraryRealization[]>(() => {
    const known = new Set(libraries.value.map((library) => library.id))
    const contributions = Array.from(discovered.value.entries())
      // Drop results from libraries that have since been removed.
      .filter(([libraryId]) => known.has(libraryId))
      .flatMap(([, entries]) => entries)
    return combineRealizations(contributions)
  })

  const library = (libraryId: string) =>
    libraries.value.find((candidate) => candidate.id === libraryId)

  const type = (libraryType: ProjectLibraryType) =>
    typesSignal.value.get(libraryType)

  const realization = (id: string) =>
    realizations.value.find((candidate) => candidate.id === id)

  /** Commit a settings change: persist it and mark the list user-owned. */
  const commit = (next: readonly ProjectLibrarySetting[]) => {
    stored.value = next
    seeded.value = true
    persist(next)
  }

  /** Take the currently effective settings, seeded or not, as a base to edit. */
  const currentSettings = () => [...settings.value]

  /**
   * Roots of other libraries nested inside this one.
   *
   * Passed to discovery so a library does not report another library's projects
   * as its own. Only strictly-nested paths count: two libraries at the *same*
   * path are overlapping views of one folder, and a project seen through both
   * is meant to belong to both.
   */
  const nestedLibraryPaths = (target: ProjectLibrary) => {
    const targetPath = normalizePath(target.path)
    return libraries.value
      .filter((other) => other.id !== target.id)
      .map((other) => normalizePath(other.path))
      .filter((path) => path !== targetPath && isPathInside(targetPath, path))
  }

  const scanLibrary = async (
    target: ProjectLibrary,
    signal: AbortSignal
  ): Promise<readonly ProjectLibraryRealizationContribution[]> => {
    const contribution = type(target.type)
    if (!contribution?.readRealizations) return []

    const found = await contribution.readRealizations({
      library: target,
      signal,
      excludePaths: nestedLibraryPaths(target),
    })
    // Stamp membership here so a type never has to remember to.
    return found.map((entry) => ({
      ...entry,
      libraryIds: Array.from(new Set([...(entry.libraryIds ?? []), target.id])),
    }))
  }

  const refresh = async (libraryId?: string) => {
    scanController?.abort()
    const controller = new AbortController()
    scanController = controller

    const targets = libraryId
      ? [library(libraryId)].filter((candidate): candidate is ProjectLibrary =>
          Boolean(candidate)
        )
      : [...libraries.value]

    if (targets.length === 0) {
      state.value = 'ready'
      return
    }

    state.value = 'scanning'
    error.value = null

    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          return {
            libraryId: target.id,
            entries: await scanLibrary(target, controller.signal),
            failure: null as string | null,
          }
        } catch (caught) {
          const message =
            caught instanceof Error ? caught.message : 'Could not read library'
          console.error(
            `projectLibraries: scanning "${target.title}" failed`,
            caught
          )
          return { libraryId: target.id, entries: [], failure: message }
        }
      })
    )

    // A newer scan started while this one was running; its results win.
    if (controller.signal.aborted) return

    const next = new Map(discovered.value)
    for (const result of results) next.set(result.libraryId, result.entries)
    discovered.value = next

    const failures = results
      .map((result) => result.failure)
      .filter((message): message is string => Boolean(message))
    error.value = failures.length > 0 ? failures[0] : null
    state.value = failures.length > 0 ? 'error' : 'ready'
  }

  /** Resolve a realization to the library that should act on it. */
  const owningLibrary = (target: ProjectLibraryRealization) => {
    for (const libraryId of target.libraryIds) {
      const found = library(libraryId)
      if (found) return found
    }
    return undefined
  }

  const operationFor = <
    Name extends keyof NonNullable<
      ProjectLibraryTypeContribution['operations']
    >,
  >(
    target: ProjectLibrary,
    name: Name
  ) => {
    const operation = type(target.type)?.operations?.[name]
    if (!operation) return undefined
    if (operation.isAvailable && !operation.isAvailable({ library: target })) {
      return undefined
    }
    return operation
  }

  return {
    settings,
    libraries,
    types: typesSignal,
    realizations,
    state: computed(() => state.value),
    error: computed(() => error.value),

    library,
    realization,
    realizationsFor: (libraryId) =>
      realizationsForLibrary(realizations.value, libraryId),
    type,

    refresh,

    addLibrary(setting) {
      const next = mergeProjectLibrarySettings(currentSettings(), [setting])
      commit(next)
      const added = librariesFromSettings(next, {
        defaultRoot: fileSystem.defaultRoot.peek(),
      }).find(
        (candidate) =>
          candidate.type === setting.type && candidate.path === setting.path
      )
      if (added) void refresh(added.id)
      return added
    },

    updateLibrary(libraryId, patch) {
      const target = library(libraryId)
      if (!target) return

      const next = currentSettings().map((setting, index) =>
        index === target.order ? { ...setting, ...patch } : setting
      )
      commit(next)
      // The id is derived from path and source, so a patch touching either
      // renames the library; rescan under whatever it is now.
      void refresh()
    },

    removeLibrary(libraryId) {
      const target = library(libraryId)
      if (!target || !this.canRemoveLibrary(libraryId)) return

      commit(currentSettings().filter((_, index) => index !== target.order))

      const next = new Map(discovered.value)
      next.delete(libraryId)
      discovered.value = next
    },

    reorderLibrary(fromIndex, toIndex) {
      commit(moveProjectLibrarySetting(currentSettings(), fromIndex, toIndex))
    },

    canRemoveLibrary(libraryId) {
      const target = library(libraryId)
      if (!target) return false
      if (type(target.type)?.removable === false) return false
      // The last library is not removable: with none, there is nowhere for a
      // new project to go and no way back except editing storage.
      return libraries.value.length > 1
    },

    async createProject(libraryId, requestedTitle) {
      const target = library(libraryId)
      if (!target) return undefined

      const operation = operationFor(target, 'createProject')
      if (!operation) return undefined

      const created = await operation.run({
        library: target,
        requestedTitle,
        initialFile: { name: 'main.kcl', contents: '' },
      })
      await refresh(libraryId)
      return created ? (realization(created.id) ?? created) : undefined
    },

    async renameProject(id, requestedTitle) {
      const target = realization(id)
      const owner = target && owningLibrary(target)
      if (!target || !owner) return

      const operation = operationFor(owner, 'renameProject')
      if (!operation) return

      await operation.run({
        library: owner,
        realization: target,
        requestedTitle,
      })
      await refresh()
    },

    async deleteProject(id) {
      const target = realization(id)
      const owner = target && owningLibrary(target)
      if (!target || !owner) return

      const operation = operationFor(owner, 'deleteProject')
      if (!operation) return

      await operation.run({ library: owner, realization: target })
      await refresh()
    },

    moveTargetsFor(id) {
      const target = realization(id)
      if (!target) return []

      return libraries.value.filter((candidate) => {
        if (target.libraryIds.includes(candidate.id)) return false
        return Boolean(operationFor(candidate, 'moveProjectTo'))
      })
    },

    async moveProject(id, targetLibraryId) {
      const target = realization(id)
      const owner = target && owningLibrary(target)
      const destination = library(targetLibraryId)
      if (!target || !owner || !destination) return

      const receive = operationFor(destination, 'moveProjectTo')
      const release = operationFor(owner, 'moveProjectFrom')
      if (!receive) return

      // The target copies first, then the source releases. If the copy fails
      // the project is still where it was, which is the safer failure.
      await receive.run({
        library: destination,
        realization: target,
        sourceLibrary: owner,
      })
      await release?.run({
        library: owner,
        realization: target,
        targetLibrary: destination,
      })
      await refresh()
    },

    dispose() {
      scanController?.abort()
    },
  }
}
