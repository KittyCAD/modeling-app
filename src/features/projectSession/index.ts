import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import { projectCatalogService } from '@src/contracts/projects'
import {
  type ProjectSession,
  projectSessionService,
} from '@src/contracts/projectSession'
import { createProjectSession } from '@src/features/projectSession/createProjectSession'

/**
 * Owns which project is open.
 *
 * Exactly one session at a time, and `null` is a first-class value rather than
 * an error path — it is what the home screen is for. Everything that used to be
 * reached through "the current project" goes through this service, so there is
 * one place that knows a project is open and one place that can close it.
 */
export default defineRegistryItemFactory((ctx) => {
  const current = signal<ProjectSession | null>(null)
  const opening = signal<string | null>(null)
  const error = signal<string | null>(null)

  const close = () => {
    current.value = null
    opening.value = null
    error.value = null
  }

  const open = async (projectId: string) => {
    if (current.peek()?.project.peek().id === projectId) return current.peek()

    opening.value = projectId
    error.value = null

    try {
      const catalog = ctx.services.get(projectCatalogService)
      const source = catalog.sourceFor(projectId)
      if (!source) throw new Error(`No source owns project "${projectId}"`)

      // Ask the source rather than the aggregated list: on a deep link the
      // catalog may not have listed anything yet.
      await source.refresh()
      const summary = source.projects.value.find(
        (project) => project.id === projectId
      )
      if (!summary) throw new Error(`No project "${projectId}"`)

      const session = createProjectSession(summary, source)
      current.value = session
      return session
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Could not open project'
      console.error('projectSession: open failed', caught)
      error.value = message
      current.value = null
      return null
    } finally {
      opening.value = null
    }
  }

  const hasProject = computed(() => current.value !== null)

  return {
    item: defineRuntimeRegistryItem({
      id: 'projectSession',
      providesServices: [
        provideService(projectSessionService, {
          current: computed(() => current.value),
          opening: computed(() => opening.value),
          error: computed(() => error.value),
          open,
          close,
        }),
      ],
      provides: [
        provide(commandsValueSpec, {
          id: 'project.close',
          title: 'Close project',
          category: 'Project',
          icon: 'home',
          enabled: hasProject,
          run: close,
        }),
        provide(commandsValueSpec, {
          id: 'project.refreshFiles',
          title: 'Refresh project files',
          category: 'Project',
          icon: 'refresh',
          enabled: hasProject,
          run: () => current.peek()?.refreshFiles(),
        }),
      ],
    }),
  }
}, 'projectSession')
