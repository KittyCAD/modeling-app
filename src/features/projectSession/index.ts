import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import {
  editorCapabilitiesValueSpec,
  editorThemesValueSpec,
} from '@src/contracts/buffers'
import { commandsValueSpec } from '@src/contracts/commands'
import { fileSystemService } from '@src/contracts/fileSystem'
import { fileWatcherService } from '@src/contracts/fileWatcher'
import { fsOperationQueueService } from '@src/contracts/fsOperations'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import {
  type ProjectSession,
  projectSessionService,
} from '@src/contracts/projectSession'
import { redo, undo } from '@codemirror/commands'
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
  const queue = () => ctx.services.get(fsOperationQueueService)
  // Optional: the web build has nothing external to watch, and a session
  // without a watcher is a session on a filesystem only this app can reach.
  const watcher = () => ctx.services.optional(fileWatcherService)
  const capabilities = () => ctx.valueSpecs.get(editorCapabilitiesValueSpec)
  const themes = () => ctx.valueSpecs.get(editorThemesValueSpec)

  const close = () => {
    // Disposing flushes pending autosaves and stops watching the folder. A
    // session dropped without it keeps a watch alive against a project nothing
    // is looking at.
    current.peek()?.dispose()
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

      const session = createProjectSession(realization, library, {
        fileSystem: fileSystem(),
        // One resolver for the whole app, evaluated per buffer. Read here rather
        // than per buffer so capability installation stays a registry concern.
        capabilities: capabilities(),
        themes: themes(),
        queue: queue(),
        watcher: watcher(),
      })
      current.peek()?.dispose()
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
          id: 'buffer.undo',
          title: 'Undo',
          category: 'Edit',
          icon: 'arrowLeft',
          shortcut: '⌘Z',
          enabled: computed(() => current.value?.activeBuffer.value !== null),
          // Routed through the buffer, not a view: undo has to work whether or
          // not the editor pane happens to be mounted.
          run: () => {
            const buffer = current.peek()?.activeBuffer.peek()
            buffer?.runCommand(undo)
          },
        }),
        provide(commandsValueSpec, {
          id: 'buffer.redo',
          title: 'Redo',
          category: 'Edit',
          icon: 'arrowUpRight',
          shortcut: '⇧⌘Z',
          enabled: computed(() => current.value?.activeBuffer.value !== null),
          run: () => {
            const buffer = current.peek()?.activeBuffer.peek()
            buffer?.runCommand(redo)
          },
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
