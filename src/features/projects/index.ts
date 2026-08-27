import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import type { LoadState } from '@src/contracts/projects'
import {
  projectCatalogService,
  projectSourcesValueSpec,
} from '@src/contracts/projects'
import { createLocalProjectSource } from '@src/features/projects/localProjectSource'

/** Registers the browser-storage source. Desktop and cloud slot in beside it. */
const localSource = defineRegistryItemFactory(() => {
  const source = createLocalProjectSource()
  return {
    model: source,
    item: defineRuntimeRegistryItem({
      id: 'projects.source.local',
      provides: [provide(projectSourcesValueSpec, source)],
    }),
  }
}, 'projects.source.local')

/**
 * Aggregates every project source into one list.
 *
 * The home screen asks the catalog, so it stays ignorant of how many backends
 * exist or which one owns a given project. Adding the cloud source later is a
 * contribution, not a change here.
 */
const catalog = defineRegistryItemFactory((ctx) => {
  const sources = computed(() => ctx.valueSpecs.get(projectSourcesValueSpec))

  const projects = computed(() =>
    sources.value
      .flatMap((source) => source.projects.value)
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
  )

  const state = computed<LoadState>(() => {
    const states = sources.value.map((source) => source.state.value)
    if (states.length === 0) return 'ready'
    if (states.includes('error')) return 'error'
    if (states.includes('loading')) return 'loading'
    return states.every((value) => value === 'ready') ? 'ready' : 'idle'
  })

  const sourceFor = (projectId: string) =>
    sources.value.find((source) =>
      source.projects.value.some((project) => project.id === projectId)
    ) ??
    // Fall back to the id prefix, so a project can be resolved before its
    // source has finished listing — which is the case on a deep link.
    sources.value.find((source) => projectId.startsWith(`${source.id}:`))

  return {
    item: defineRuntimeRegistryItem({
      id: 'projects.catalog',
      providesServices: [
        provideService(projectCatalogService, {
          sources,
          projects,
          state,
          get: (projectId) =>
            projects.value.find((project) => project.id === projectId),
          sourceFor,
          refresh: async () => {
            await Promise.all(sources.value.map((source) => source.refresh()))
          },
        }),
      ],
    }),
  }
}, 'projects.catalog')

export default defineRegistryItem({
  id: 'projects',
  uses: [localSource, catalog],
})
