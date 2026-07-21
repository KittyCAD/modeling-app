import { defineContract, defineValueSpec } from '@kittycad/registry'
import type {
  HomeProjectEntry,
  HomeProjectEntryContribution,
} from '@src/registry/contracts/homeProjects'
import type {
  ProjectLibrary,
  ProjectLibrarySetting,
  ProjectLibraryType,
} from '@src/lib/projectLibraries'
import { mergeProjectLibrarySettings } from '@src/lib/projectLibraries'
import { isArray } from '@src/lib/utils'

export type ProjectLibraryContribution =
  | ProjectLibrary
  | readonly ProjectLibrary[]

export type ProjectLibrarySettingDefaultContribution =
  | ProjectLibrarySetting
  | readonly ProjectLibrarySetting[]

export interface ProjectLibraryOperation<Input, Result = unknown> {
  isAvailable?: (input: { library: ProjectLibrary }) => boolean
  run: (input: Input) => Result | Promise<Result>
}

export interface ProjectLibraryCreateProjectInput {
  library: ProjectLibrary
  requestedProjectName: string
  requestedProjectTitle: string
}

export interface ProjectLibraryTypeOperations {
  createProject?: ProjectLibraryOperation<ProjectLibraryCreateProjectInput>
}

export interface ProjectLibraryTypeContribution {
  type: ProjectLibraryType
  title: string
  icon?: string
  order?: number
  defaultSetting?: ProjectLibrarySetting
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

export function getProjectLibraryCreateProjectOperation(
  libraryType: ProjectLibraryTypeContribution | undefined,
  library: ProjectLibrary
) {
  const operation = libraryType?.operations?.createProject
  if (!operation) {
    return undefined
  }

  if (operation.isAvailable && !operation.isAvailable({ library })) {
    return undefined
  }

  return operation
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
})

export const {
  projectLibrariesValueSpec,
  projectLibraryTypesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} = projectLibrariesContract
