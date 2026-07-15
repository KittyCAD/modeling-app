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

export interface ProjectLibraryTypeContribution {
  type: ProjectLibraryType
  title: string
  icon?: string
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
    typeById.set(contribution.type, {
      ...typeById.get(contribution.type),
      ...contribution,
    })
  }

  return typeById
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
