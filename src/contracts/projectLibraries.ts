import {
  appendValueSpec,
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { IconName } from '@kittycad/ui-kit'
import type { ReadonlySignal } from '@preact/signals'
import type {
  ProjectLibrary,
  ProjectLibraryRealization,
  ProjectLibraryRealizationContribution,
  ProjectLibrarySetting,
  ProjectLibraryType,
} from '@src/lib/projectLibraries'
import { mergeProjectLibrarySettings } from '@src/lib/projectLibraries'

export type LibraryLoadState = 'idle' | 'scanning' | 'ready' | 'error'

/**
 * One operation a library type can perform.
 *
 * `isAvailable` exists so a type can support an operation in general but decline
 * it for a particular library — a read-only mount, a library whose root is
 * missing — without the caller having to know why.
 */
export interface ProjectLibraryOperation<Input, Result = void> {
  isAvailable?: (input: { library: ProjectLibrary }) => boolean
  run: (input: Input) => Promise<Result>
}

export interface CreateProjectInput {
  library: ProjectLibrary
  /** What the user typed. The type decides the folder name. */
  requestedTitle: string
  /** Written before the project is published, so it never appears empty. */
  initialFile?: { name: string; contents: string }
}

export interface RealizationInput {
  library: ProjectLibrary
  realization: ProjectLibraryRealization
}

export interface RenameProjectInput extends RealizationInput {
  requestedTitle: string
}

/** Taking a project out of its library. Returns what the target needs. */
export interface MoveProjectFromInput extends RealizationInput {
  targetLibrary: ProjectLibrary
}

/** Receiving a project into a library. */
export interface MoveProjectToInput extends RealizationInput {
  sourceLibrary: ProjectLibrary
}

export interface ProjectLibraryTypeOperations {
  createProject?: ProjectLibraryOperation<
    CreateProjectInput,
    ProjectLibraryRealization | undefined
  >
  renameProject?: ProjectLibraryOperation<RenameProjectInput>
  deleteProject?: ProjectLibraryOperation<RealizationInput>
  /**
   * Split in two halves on purpose. A move between libraries of different types
   * is the source handing bytes to the target, and neither side should have to
   * know how the other stores them.
   */
  moveProjectFrom?: ProjectLibraryOperation<MoveProjectFromInput>
  moveProjectTo?: ProjectLibraryOperation<
    MoveProjectToInput,
    ProjectLibraryRealization | undefined
  >
}

/**
 * A kind of place projects live.
 *
 * Types are contributed, so adding cloud or network libraries later means a new
 * registry item and no change to the service, the home screen, or settings.
 */
export interface ProjectLibraryTypeContribution {
  type: ProjectLibraryType
  /** Shown when choosing what kind of library to add. */
  title: string
  icon: IconName
  order?: number
  /** One line explaining where projects in such a library actually live. */
  description: string
  /** What the `path` field means for this type, e.g. `Folder`. */
  locationLabel: string
  /** Template for a newly added library of this type. */
  newLibrarySetting?: (input: { defaultRoot: string }) => ProjectLibrarySetting
  /** False for types the user cannot remove, like a mandatory cloud library. */
  removable?: boolean
  operations?: ProjectLibraryTypeOperations
  /**
   * Find the project folders in one configured library.
   *
   * Returns observations only. Merging across libraries, and deciding what a
   * project *is*, happens above this.
   *
   * `excludePaths` holds the roots of other libraries nested inside this one. A
   * nested library is a library, not a project, so scanning past it would list
   * its contents twice — once correctly and once as a project of the parent.
   */
  readRealizations?: (input: {
    library: ProjectLibrary
    signal: AbortSignal
    excludePaths: readonly string[]
  }) => Promise<ProjectLibraryRealizationContribution[]>
}

export interface ProjectLibrariesService {
  /** Persisted configuration, in user order. */
  readonly settings: ReadonlySignal<readonly ProjectLibrarySetting[]>
  /** Settings resolved into addressable libraries. */
  readonly libraries: ReadonlySignal<readonly ProjectLibrary[]>
  readonly types: ReadonlySignal<
    ReadonlyMap<ProjectLibraryType, ProjectLibraryTypeContribution>
  >
  readonly realizations: ReadonlySignal<readonly ProjectLibraryRealization[]>
  readonly state: ReadonlySignal<LibraryLoadState>
  readonly error: ReadonlySignal<string | null>

  library(libraryId: string): ProjectLibrary | undefined
  realization(realizationId: string): ProjectLibraryRealization | undefined
  realizationsFor(libraryId: string): readonly ProjectLibraryRealization[]
  type(
    libraryType: ProjectLibraryType
  ): ProjectLibraryTypeContribution | undefined

  /** Rescan. Pass a library id when you know which one changed. */
  refresh(libraryId?: string): Promise<void>

  addLibrary(setting: ProjectLibrarySetting): ProjectLibrary | undefined
  updateLibrary(libraryId: string, patch: Partial<ProjectLibrarySetting>): void
  removeLibrary(libraryId: string): void
  reorderLibrary(fromIndex: number, toIndex: number): void
  canRemoveLibrary(libraryId: string): boolean

  createProject(
    libraryId: string,
    requestedTitle: string
  ): Promise<ProjectLibraryRealization | undefined>
  renameProject(realizationId: string, requestedTitle: string): Promise<void>
  deleteProject(realizationId: string): Promise<void>
  /** Targets a project can move to, excluding the one it is already in. */
  moveTargetsFor(realizationId: string): readonly ProjectLibrary[]
  moveProject(realizationId: string, targetLibraryId: string): Promise<void>
}

/**
 * Merge type contributions by type name, unioning their operations.
 *
 * Two registry items can extend one type — a plugin adding `moveProjectTo` to
 * `directory`, say — without either knowing about the other.
 */
export function combineProjectLibraryTypes(
  contributions: readonly ProjectLibraryTypeContribution[]
): Map<ProjectLibraryType, ProjectLibraryTypeContribution> {
  const byType = new Map<ProjectLibraryType, ProjectLibraryTypeContribution>()

  for (const contribution of contributions) {
    const previous = byType.get(contribution.type)
    const operations = {
      ...previous?.operations,
      ...contribution.operations,
    }
    const merged: ProjectLibraryTypeContribution = {
      ...previous,
      ...contribution,
    }
    if (Object.keys(operations).length > 0) merged.operations = operations
    byType.set(contribution.type, merged)
  }

  return byType
}

export const projectLibrariesContract = defineContract({
  projectLibraryTypesValueSpec: defineValueSpec<
    ProjectLibraryTypeContribution,
    Map<ProjectLibraryType, ProjectLibraryTypeContribution>
  >({
    name: 'projectLibraries.types',
    defaultValue: new Map(),
    combine: combineProjectLibraryTypes,
  }),
  /**
   * Libraries that should exist before the user configures anything.
   *
   * A function of the default root rather than a literal, because the root is
   * platform-dependent and not known until the filesystem resolves.
   */
  projectLibraryDefaultsValueSpec: defineValueSpec<
    (input: { defaultRoot: string }) => readonly ProjectLibrarySetting[],
    ((input: { defaultRoot: string }) => readonly ProjectLibrarySetting[])[]
  >({
    name: 'projectLibraries.defaults',
    defaultValue: [],
    combine: (inputs) => [...inputs],
  }),
  projectLibrariesService: defineService<ProjectLibrariesService>(
    'projectLibraries.service'
  ),
})

export const {
  projectLibraryTypesValueSpec,
  projectLibraryDefaultsValueSpec,
  projectLibrariesService,
} = projectLibrariesContract

/** Resolve the defaults contributed by every feature into one merged list. */
export function resolveLibraryDefaults(
  factories: readonly ((input: {
    defaultRoot: string
  }) => readonly ProjectLibrarySetting[])[],
  defaultRoot: string
): ProjectLibrarySetting[] {
  return mergeProjectLibrarySettings(
    ...factories.map((factory) => factory({ defaultRoot }))
  )
}
