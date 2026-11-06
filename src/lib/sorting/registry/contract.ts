import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ProjectSort, ProjectSortField } from '@src/lib/sorting'

/** Application-owned project-list preference, independent of browser location. */
export interface ProjectSortingService {
  sort: ReadonlySignal<ProjectSort>
  toggle: (field: ProjectSortField) => void
}

export const projectSortingContract = defineContract({
  projectSortingService: defineService<ProjectSortingService>(
    'project-sorting.service'
  ),
})

export const { projectSortingService } = projectSortingContract
