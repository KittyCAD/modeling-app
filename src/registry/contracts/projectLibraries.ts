import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { Project } from '@src/lib/project'
import type { DuplicateProjectResult } from '@src/lib/projectDuplication'
import type {
  ProjectLibrary,
  ProjectLibrarySetting,
  ProjectLibraryType,
} from '@src/lib/projectLibraries'
import {
  mergeProjectLibrarySettings,
  normalizeLibraryPath,
} from '@src/lib/projectLibraries'
import type { HideOnPlatformValue } from '@src/lib/settings/settingsTypes'
import { isArray } from '@src/lib/utils'
import type {
  HomeProjectEntry,
  HomeProjectOpenResult,
} from '@src/registry/contracts/homeProjects'
import type { ComponentType } from 'react'

export type ProjectLibrarySettingDefaultContribution =
  | ProjectLibrarySetting
  | readonly ProjectLibrarySetting[]

export interface ProjectLibrarySettingDefaultPolicyInput {
  initialDefaultDir: string
  legacyProjectDirectory?: string
  isDesktop: boolean
}

export interface ProjectLibrarySettingDefaultPolicy {
  id: string
  priority?: number
  getDefaultLibraries: (
    input: ProjectLibrarySettingDefaultPolicyInput
  ) => readonly ProjectLibrarySetting[] | undefined
}

export type ProjectLibrarySettingDefaultPolicyContribution =
  | ProjectLibrarySettingDefaultPolicy
  | readonly ProjectLibrarySettingDefaultPolicy[]

export type ProjectLibraryRealizationThumbnail = {
  type: 'local'
  path: string
}

export type ProjectLibraryRealizationSyncFailure = {
  message: string
  at?: string
  kind?: string
}

export type ProjectLibraryRealizationLibraryRef = Pick<
  ProjectLibrary,
  'id' | 'title' | 'path' | 'type' | 'order'
>

/**
 * A project library is a configured source that can discover and operate on
 * project storage.
 *
 * A local realization is one concrete project folder on disk. The same local
 * realization may be visible through multiple libraries when library paths
 * overlap, but cloud identity is not resolved here. If two local realizations
 * point at the same cloud project ID, they remain two realizations so cloudSync
 * can classify and clean them up with full disk/metadata context.
 */
export interface ProjectLibraryRealization {
  id: string
  libraryIds: readonly string[]
  libraryRefs: readonly ProjectLibraryRealizationLibraryRef[]
  localProjectPath: string
  localProjectName: string
  name: string
  title?: string
  cloudProjectId?: string
  modified?: number
  defaultFile?: string
  kclFileCount?: number
  directoryCount?: number
  readWriteAccess: boolean
  thumbnail?: ProjectLibraryRealizationThumbnail
  conflict?: unknown
  syncFailure?: ProjectLibraryRealizationSyncFailure
}

export type ProjectLibraryRealizationContribution = Omit<
  ProjectLibraryRealization,
  'id' | 'libraryIds' | 'libraryRefs'
> & {
  id?: string
  library?: ProjectLibrary
  libraryId?: string
  libraryIds?: readonly string[]
  libraryRefs?: readonly ProjectLibraryRealizationLibraryRef[]
}

export type ProjectLibraryRealizationContributionGroup =
  | ProjectLibraryRealizationContribution
  | readonly ProjectLibraryRealizationContribution[]

export type ProjectLibraryRealizationsInvalidationInput = {
  libraryId?: string
}

export type ProjectLibraryRealizationWatchOptions = {
  libraries: readonly ProjectLibrary[]
}

export interface ProjectLibraryRealizationsService {
  /**
   * Refreshes configured realization discovery. Prefer passing `libraryId`
   * whenever the caller knows which library changed.
   */
  invalidate: (input?: ProjectLibraryRealizationsInvalidationInput) => void
  /**
   * Watches configured library roots for realization boundary changes while a UI
   * surface needs live discovery updates. The returned disposer must be called
   * when that surface unmounts.
   */
  watchConfiguredLibraries: (
    options: ProjectLibraryRealizationWatchOptions
  ) => () => void
}

export interface ProjectLibraryOperation<
  Input extends { library: ProjectLibrary },
  Result = unknown,
> {
  isAvailable?: (input: { library: ProjectLibrary }) => boolean
  run: (input: Input) => Result | Promise<Result>
}

export interface ProjectLibraryCreateProjectInput {
  library: ProjectLibrary
  requestedProjectName: string
  requestedProjectTitle: string
  initialKclFile?: {
    fileName: string
    code: string
  }
}

export interface ProjectLibraryProjectInput {
  library: ProjectLibrary
  project: HomeProjectEntry
}

export type ProjectLibraryOpenProjectInput = ProjectLibraryProjectInput

export type ProjectLibraryDuplicateProjectInput = ProjectLibraryProjectInput

export interface ProjectLibraryRenameProjectInput
  extends ProjectLibraryProjectInput {
  requestedName: string
}

export type ProjectLibraryDeleteProjectInput = ProjectLibraryProjectInput

export interface ProjectLibraryMoveProjectFromInput
  extends ProjectLibraryProjectInput {
  targetLibrary: ProjectLibrary
}

export interface ProjectLibraryMoveProjectSource {
  localProjectPath: string
  localProjectName: string
  defaultFile?: string
}

export interface ProjectLibraryMoveProjectToInput
  extends ProjectLibraryProjectInput {
  sourceLibrary: ProjectLibrary
  source: ProjectLibraryMoveProjectSource
}

export interface ProjectLibraryMoveProjectResult {
  localProjectPath?: string
  defaultFile?: string
}

export interface ProjectLibraryMoveProjectFromOperation
  extends ProjectLibraryOperation<
    ProjectLibraryMoveProjectFromInput,
    ProjectLibraryMoveProjectSource | undefined
  > {
  canMoveProject?: (input: ProjectLibraryProjectInput) => boolean
}

export interface ProjectLibraryMoveProjectToOperation
  extends ProjectLibraryOperation<
    ProjectLibraryMoveProjectToInput,
    ProjectLibraryMoveProjectResult | undefined
  > {
  canReceiveProject?: (
    input: Omit<ProjectLibraryMoveProjectToInput, 'source'>
  ) => boolean
}

export interface ProjectLibraryTypeOperations {
  createProject?: ProjectLibraryOperation<
    ProjectLibraryCreateProjectInput,
    Project | undefined
  >
  openProject?: ProjectLibraryOperation<
    ProjectLibraryOpenProjectInput,
    HomeProjectOpenResult | undefined
  >
  duplicateProject?: ProjectLibraryOperation<
    ProjectLibraryDuplicateProjectInput,
    DuplicateProjectResult | undefined
  >
  renameProject?: ProjectLibraryOperation<ProjectLibraryRenameProjectInput>
  deleteProject?: ProjectLibraryOperation<ProjectLibraryDeleteProjectInput>
  moveProjectFrom?: ProjectLibraryMoveProjectFromOperation
  moveProjectTo?: ProjectLibraryMoveProjectToOperation
}

export interface ProjectLibrarySettingsDetailsProps {
  library: ProjectLibrarySetting
  index: number
  updateLibrary: (library: ProjectLibrarySetting) => void
  commitLibrary: (library?: ProjectLibrarySetting) => void
  readOnly?: boolean
  chooseDirectory?: (input: {
    defaultPath?: string
    title?: string
  }) => Promise<string | undefined>
}

export interface ProjectLibraryTypeContribution {
  type: ProjectLibraryType
  title: string
  icon?: string
  order?: number
  /** Initial value used when settings are seeded or migrated for this type. */
  defaultSetting?: ProjectLibrarySetting
  /** Template used when a user manually adds a new library of this type. */
  newLibrarySetting?: ProjectLibrarySetting
  /** Optional detail cell rendered in the project libraries settings row. */
  settingsDetails?: ComponentType<ProjectLibrarySettingsDetailsProps>
  /** Hide this type from creation/editing UI while keeping runtime support. */
  hideInSettingsOnPlatform?: HideOnPlatformValue
  operations?: ProjectLibraryTypeOperations
  /**
   * Discover local project folders for one configured library. Implementations
   * return observations only; identity resolution across cloud project IDs is not
   * part of the projectLibraries contract.
   */
  readRealizations?: (input: {
    library: ProjectLibrary
    signal: AbortSignal
  }) => Promise<ProjectLibraryRealizationContribution[]>
}

export function getProjectLibraryRealizationsForLibrary(
  realizations: readonly ProjectLibraryRealization[],
  libraryId: string
) {
  return realizations.filter((realization) =>
    realization.libraryIds.includes(libraryId)
  )
}

export function getHomeProjectEntriesForLibrary(
  projects: readonly HomeProjectEntry[],
  libraryId: string
) {
  return projects.filter((project) => project.libraryIds?.includes(libraryId))
}

export function combineProjectLibraryTypes(
  contributions: readonly ProjectLibraryTypeContribution[]
) {
  const typeById = new Map<ProjectLibraryType, ProjectLibraryTypeContribution>()

  for (const contribution of contributions) {
    const previousContribution = typeById.get(contribution.type)
    const operations = {
      ...previousContribution?.operations,
      ...contribution.operations,
    }
    const nextContribution: ProjectLibraryTypeContribution = {
      ...previousContribution,
      ...contribution,
    }
    if (Object.keys(operations).length > 0) {
      nextContribution.operations = operations
    }
    typeById.set(contribution.type, nextContribution)
  }

  return typeById
}

export function getProjectLibraryOperation<
  OperationName extends keyof ProjectLibraryTypeOperations,
>(
  libraryType: ProjectLibraryTypeContribution | undefined,
  library: ProjectLibrary,
  operationName: OperationName
): ProjectLibraryTypeOperations[OperationName] | undefined {
  const operation = libraryType?.operations?.[operationName]
  if (!operation) {
    return undefined
  }

  if (operation.isAvailable && !operation.isAvailable({ library })) {
    return undefined
  }

  return operation
}

export function getProjectLibraryCreateProjectOperation(
  libraryType: ProjectLibraryTypeContribution | undefined,
  library: ProjectLibrary
) {
  return getProjectLibraryOperation(libraryType, library, 'createProject')
}

export function combineProjectLibrarySettingDefaults(
  contributions: readonly ProjectLibrarySettingDefaultContribution[]
) {
  return mergeProjectLibrarySettings(
    contributions.flatMap((contribution) =>
      isArray(contribution) ? contribution : [contribution]
    )
  )
}

export function combineProjectLibrarySettingDefaultPolicies(
  contributions: readonly ProjectLibrarySettingDefaultPolicyContribution[]
) {
  return contributions
    .flatMap((contribution) =>
      isArray(contribution) ? contribution : [contribution]
    )
    .toSorted((a, b) => {
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0)
      return priorityDiff === 0 ? a.id.localeCompare(b.id) : priorityDiff
    })
}

export function resolveProjectLibrarySettingDefaults(
  policies: readonly ProjectLibrarySettingDefaultPolicy[],
  input: ProjectLibrarySettingDefaultPolicyInput
) {
  for (const policy of policies) {
    const defaults = policy.getDefaultLibraries(input)
    if (defaults && defaults.length > 0) {
      return mergeProjectLibrarySettings(defaults)
    }
  }

  return []
}

function projectLibraryRealizationStableId(
  realization: ProjectLibraryRealizationContribution
) {
  return `local:${normalizeLibraryPath(realization.localProjectPath)}`
}

function projectLibraryRealizationLibraryIds(
  realization: ProjectLibraryRealizationContribution
) {
  return Array.from(
    new Set(
      [
        realization.library?.id,
        realization.libraryId,
        ...(realization.libraryIds ?? []),
        ...(realization.libraryRefs?.map((library) => library.id) ?? []),
      ].filter((libraryId): libraryId is string => Boolean(libraryId))
    )
  )
}

function projectLibraryRealizationLibraryRefs(
  realization: ProjectLibraryRealizationContribution
) {
  const refsById = new Map<string, ProjectLibraryRealizationLibraryRef>()

  for (const ref of realization.libraryRefs ?? []) {
    refsById.set(ref.id, ref)
  }
  if (realization.library) {
    refsById.set(realization.library.id, {
      id: realization.library.id,
      title: realization.library.title,
      path: realization.library.path,
      type: realization.library.type,
      order: realization.library.order,
    })
  } else if (realization.libraryId) {
    refsById.set(realization.libraryId, {
      id: realization.libraryId,
      title: realization.libraryId,
      path: '',
      type: '',
    })
  }

  return Array.from(refsById.values())
}

function projectLibraryRealizationFromContribution(
  contribution: ProjectLibraryRealizationContribution
): ProjectLibraryRealization {
  const {
    id,
    library: _library,
    libraryId: _libraryId,
    libraryIds: _libraryIds,
    libraryRefs: _libraryRefs,
    localProjectPath,
    ...realization
  } = contribution

  return {
    ...realization,
    id: id ?? projectLibraryRealizationStableId(contribution),
    libraryIds: projectLibraryRealizationLibraryIds(contribution),
    libraryRefs: projectLibraryRealizationLibraryRefs(contribution),
    localProjectPath: normalizeLibraryPath(localProjectPath),
  }
}

/**
 * Combines realization observations by normalized local path only. Overlapping
 * libraries preserve all memberships on a single realization; separate folders
 * that reference the same cloud project remain separate for cloudSync policy.
 */
export function combineProjectLibraryRealizationContributions(
  contributionGroups: readonly ProjectLibraryRealizationContributionGroup[]
) {
  const realizationsByPath = new Map<string, ProjectLibraryRealization>()

  for (const contribution of contributionGroups.flatMap((group) =>
    isArray(group) ? group : [group]
  )) {
    const realization = projectLibraryRealizationFromContribution(contribution)
    const pathKey = normalizeLibraryPath(realization.localProjectPath)
    const existing = realizationsByPath.get(pathKey)
    realizationsByPath.set(
      pathKey,
      existing
        ? {
            ...existing,
            ...realization,
            libraryIds: Array.from(
              new Set([...existing.libraryIds, ...realization.libraryIds])
            ),
            libraryRefs: Array.from(
              new Map(
                [...existing.libraryRefs, ...realization.libraryRefs].map(
                  (library) => [library.id, library]
                )
              ).values()
            ),
          }
        : realization
    )
  }

  return Array.from(realizationsByPath.values())
}

export const projectLibrariesContract = defineContract({
  projectLibraryRealizationsService:
    defineService<ProjectLibraryRealizationsService>(
      'project-library-realizations'
    ),
  projectLibraryTypesValueSpec: defineValueSpec<
    ProjectLibraryTypeContribution,
    Map<ProjectLibraryType, ProjectLibraryTypeContribution>
  >({
    name: 'project-library-types',
    defaultValue: new Map(),
    combine: combineProjectLibraryTypes,
  }),
  projectLibrarySettingDefaultsValueSpec: defineValueSpec<
    ProjectLibrarySettingDefaultContribution,
    ProjectLibrarySetting[]
  >({
    name: 'project-library-setting-defaults',
    defaultValue: [],
    combine: combineProjectLibrarySettingDefaults,
  }),
  projectLibrarySettingDefaultPoliciesValueSpec: defineValueSpec<
    ProjectLibrarySettingDefaultPolicyContribution,
    ProjectLibrarySettingDefaultPolicy[]
  >({
    name: 'project-library-setting-default-policies',
    defaultValue: [],
    combine: combineProjectLibrarySettingDefaultPolicies,
  }),
  projectLibraryRealizationsValueSpec: defineValueSpec<
    ProjectLibraryRealizationContributionGroup,
    ProjectLibraryRealization[]
  >({
    name: 'project-library-realizations',
    defaultValue: [],
    combine: combineProjectLibraryRealizationContributions,
  }),
})

export const {
  projectLibraryRealizationsService,
  projectLibraryTypesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibraryRealizationsValueSpec,
} = projectLibrariesContract
