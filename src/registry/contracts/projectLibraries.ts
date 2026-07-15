import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { isArray } from '@src/lib/utils'

export type ProjectLibraryContribution =
  | ProjectLibrary
  | readonly ProjectLibrary[]

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

export const projectLibrariesContract = defineContract({
  projectLibrariesValueSpec: defineValueSpec<
    ProjectLibraryContribution,
    ProjectLibrary[]
  >({
    name: 'project-libraries',
    defaultValue: [],
    combine: combineProjectLibraries,
  }),
})

export const { projectLibrariesValueSpec } = projectLibrariesContract
