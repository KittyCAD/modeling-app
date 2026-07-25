import { defineContract, defineValueSpec } from '@kittycad/registry'
import type {
  HomeProjectEntry,
  HomeProjectEntryContribution,
  HomeProjectOpenResult,
} from '@src/registry/contracts/homeProjects'
import type { Project } from '@src/lib/project'
import type {
  ProjectLibrary,
  ProjectLibrarySetting,
  ProjectLibraryType,
} from '@src/lib/projectLibraries'
import { mergeProjectLibrarySettings } from '@src/lib/projectLibraries'
import type { HideOnPlatformValue } from '@src/lib/settings/settingsTypes'
import { isArray } from '@src/lib/utils'
import type { ComponentType } from 'react'

export type ProjectLibraryContribution =
  | ProjectLibrary
  | readonly ProjectLibrary[]

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
}

export interface ProjectLibraryProjectInput {
  library: ProjectLibrary
  project: HomeProjectEntry
}

export type ProjectLibraryOpenProjectInput = ProjectLibraryProjectInput

export interface ProjectLibraryRenameProjectInput
  extends ProjectLibraryProjectInput {
  requestedName: string
}

export type ProjectLibraryDeleteProjectInput = ProjectLibraryProjectInput

export interface ProjectLibraryTypeOperations {
  createProject?: ProjectLibraryOperation<
    ProjectLibraryCreateProjectInput,
    Project | undefined
  >
  openProject?: ProjectLibraryOperation<
    ProjectLibraryOpenProjectInput,
    HomeProjectOpenResult | undefined
  >
  renameProject?: ProjectLibraryOperation<ProjectLibraryRenameProjectInput>
  deleteProject?: ProjectLibraryOperation<ProjectLibraryDeleteProjectInput>
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
  readEntries?: (input: {
    library: ProjectLibrary
    signal: AbortSignal
  }) => Promise<HomeProjectEntryContribution[]>
}

export function combineProjectLibraries(
  contributionGroups: readonly ProjectLibraryContribution[]
) {
  const libraries = contributionGroups.flatMap((contribution) =>
    isArray(contribution) ? contribution : [contribution]
  )
  const librariesById = new Map<string, ProjectLibrary>()

  for (const library of libraries) {
    librariesById.set(library.id, {
      ...librariesById.get(library.id),
      ...library,
    })
  }

  return Array.from(librariesById.values()).toSorted((a, b) => {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0)
    return orderDiff === 0 ? a.title.localeCompare(b.title) : orderDiff
  })
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

export const projectLibrariesContract = defineContract({
  projectLibrariesValueSpec: defineValueSpec<
    ProjectLibraryContribution,
    ProjectLibrary[]
  >({
    name: 'project-libraries',
    defaultValue: [],
    combine: combineProjectLibraries,
  }),
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
})

export const {
  projectLibrariesValueSpec,
  projectLibraryTypesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
  projectLibrarySettingDefaultPoliciesValueSpec,
} = projectLibrariesContract
