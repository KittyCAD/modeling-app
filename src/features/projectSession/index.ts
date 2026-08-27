import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import { fileSystemService } from '@src/contracts/fileSystem'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import {
  type ProjectSession,
  projectSessionService,
} from '@src/contracts/projectSession'
import { createProjectSession } from '@src/features/projectSession/createProjectSession'

/**
 * Owns which project is open.
 *
 * Exactly one session at a time, and `null` is a first-class value rather than
 * an error path — it is what the home screen is for. Projects are addressed by
 * realization id, so opening one goes through the libraries service and this
 * feature never learns what kind of library it came from.
 */
export default defineRegistryItemFactory((ctx) => {
  const current = signal<ProjectSession | null>(null)
  const opening = signal<string | null>(null)
  const error = signal<string | null>(null)

  const libraries = () => ctx.services.get(projectLibrariesService)
  const fileSystem = () => ctx.services.get(fileSystemService)

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
      const service = libraries()

      // A deep link can arrive before anything has been scanned, so discovery
      // has to be given a chance before concluding the project is missing.
      let realization = service.realization(projectId)
      if (!realization) {
        await service.refresh()
        realization = service.realization(projectId)
      }
      if (!realization) throw new Error(`No project "${projectId}"`)

      const library = realization.libraryIds
        .map((id) => service.library(id))
        .find((candidate) => candidate !== undefined)

      const session = createProjectSession(realization, library, fileSystem())
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
