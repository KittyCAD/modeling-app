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
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import { fileSystemService } from '@src/contracts/fileSystem'
import { fileWatcherService } from '@src/contracts/fileWatcher'
import { fsOperationQueueService } from '@src/contracts/fsOperations'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import { openDefaultFile } from '@src/features/projectSession/openDefaultFile'
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
      /*
       * Land in a file rather than in an empty editor. This is the only place
       * that can decide it: the realization knows its own default, and only here
       * is it known that a project was *just* opened rather than already being
       * open.
       *
       * Before the session is published, not after. The URL is derived from what
       * is open, so publishing first would announce a project with no file and
       * then a project with one — two history entries, the first of which nobody
       * asked to visit and Back would return to. Nothing observes the session in
       * its fileless state this way.
       */
      await openDefaultFile(session, realization, fileSystem())

      // Disposed immediately before publishing, so `current` never points at a
      // session that has been torn down.
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
        /**
         * The bindings the palette has been advertising all along.
         *
         * Until now `buffer.undo` printed `⌘Z` and nothing bound it: undo worked
         * only because CodeMirror's own `historyKeymap` is in the baseline
         * capability, so it worked with the editor focused and nowhere else.
         *
         * Base scope, and safe there: the keymap hands the platform's editing
         * chords to whatever is holding text, so `⌘Z` in a rename field or in the
         * code editor still means "undo my typing", and this applies everywhere
         * else — the tree, the viewport, a panel — where the app's undo is the
         * only undo there is.
         */
        provide(keybindingsValueSpec, {
          keystrokes: ['Mod+Z'],
          commandId: 'buffer.undo',
        }),
        provide(keybindingsValueSpec, {
          keystrokes: ['Mod+Shift+Z'],
          commandId: 'buffer.redo',
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
