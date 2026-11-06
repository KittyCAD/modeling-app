import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import {
  DEFAULT_PROJECT_SORT,
  getNextProjectSort,
  parseProjectSort,
  type ProjectSort,
} from '@src/lib/sorting'
import {
  type ProjectSortingService,
  projectSortingService,
} from '@src/lib/sorting/registry/contract'
import {
  defineUrlContribution,
  urlContributionsValueSpec,
} from '@src/registry/contracts/url'

export const projectSortingExtension = defineRegistryItemFactory(() => {
  // Absence means no preference was supplied: do not add query state at startup.
  const preference = signal<ProjectSort | undefined>(undefined)
  const sort = computed(() => preference.value ?? DEFAULT_PROJECT_SORT)
  const service: ProjectSortingService = {
    sort,
    toggle: (field) => {
      preference.value = getNextProjectSort(sort.value, field)
    },
  }
  const urlContribution = defineUrlContribution({
    id: 'project-sorting',
    queryKeys: ['sort_by'],
    parse: (params) => {
      const value = params.get('sort_by')
      return value === null ? undefined : { sort: parseProjectSort(value) }
    },
    initialize: (value) => {
      preference.value = value.sort
    },
    serialize: () => ({
      sort_by: preference.value === '' ? undefined : preference.value,
    }),
  })

  return {
    id: 'project-sorting-extension',
    providesServices: [provideService(projectSortingService, service)],
    provides: [provide(urlContributionsValueSpec, urlContribution)],
  }
}, 'project-sorting-extension')

export default defineRegistryItem({
  id: 'project-sorting',
  uses: [projectSortingExtension],
})
