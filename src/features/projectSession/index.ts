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
import { projectHistoryService } from '@src/contracts/projectHistory'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import type {
  ProjectGone,
  ProjectGoneReason,
} from '@src/contracts/projectSession'
import { watchRemovedProjects } from '@src/features/projectSession/watchRemovedProjects'
import { unitsService } from '@src/contracts/units'
import { openDefaultFile } from '@src/features/projectSession/openDefaultFile'
import {
  type ProjectSession,
  projectSessionService,
} from '@src/contracts/projectSession'
import { redo, undo, undoDepth } from '@codemirror/commands'
import { createProjectSession } from '@src/features/projectSession/createProjectSession'
import { projectActionToUndo } from '@src/lib/collab/projectUndo'

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

  /** Listeners for projects going away. See `onProjectGone`. */
  const goneListeners = new Set<(event: ProjectGone) => void>()

  /**
   * Projects this app has actually had open, by path.
   *
   * Only these are worth announcing about: a project nobody opened has nothing
   * holding work for it, and announcing every project ever scanned would make
   * every listener filter the same noise.
   */
  const opened = new Set<string>()

  const announceGone = (projectPath: string, reason: ProjectGoneReason) => {
    opened.delete(projectPath)
    for (const listener of [...goneListeners]) listener({ projectPath, reason })
  }

  const close = () => {
    const path = current.peek()?.project.peek().path ?? null

    // Disposing flushes pending autosaves and stops watching the folder. A
    // session dropped without it keeps a watch alive against a project nothing
    // is looking at.
    current.peek()?.dispose()
    current.value = null
    opening.value = null
    error.value = null

    // After the session is gone, so a listener that asks what is open gets the
    // answer the rest of the app already has.
    if (path !== null) announceGone(path, 'closed')
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
        /*
         * What a new file starts as.
         *
         * KCL files get a settings annotation; anything else starts empty,
         * because a `.md` with a KCL attribute at the top would be nonsense.
         * Optional service, so a build without units still creates files.
         */
        initialContents: async (path) =>
          path.endsWith('.kcl')
            ? ((await ctx.services.optional(unitsService)?.newFileContents()) ??
              '')
            : '',
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
      const previous = current.peek()
      const previousPath = previous?.project.peek().path ?? null
      previous?.dispose()
      current.value = session
      opened.add(realization.path)

      /*
       * Switching straight from one project to another is the outgoing one
       * closing, and has to be announced as such — otherwise the only ending
       * that gets reported is the one that goes via home, and a listener holding
       * work for the old project keeps holding it.
       */
      if (previousPath !== null && previousPath !== realization.path) {
        announceGone(previousPath, 'closed')
      }

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

  /*
   * A project that has vanished from the libraries is gone for good.
   *
   * The conditions that decide *when* that is true live in
   * `watchRemovedProjects`, where they can be tested: getting them wrong means
   * announcing removal mid-rescan and telling every listener to throw away work.
   */
  let stopWatchingLibraries: (() => void) | undefined
  let disposed = false
  queueMicrotask(() => {
    if (disposed) return
    const service = libraries()

    stopWatchingLibraries = watchRemovedProjects({
      paths: computed(() =>
        service.realizations.value.map((each) => each.path)
      ),
      state: computed(() => service.state.value),
      opened: () => opened,
      announce: (projectPath) => announceGone(projectPath, 'removed'),
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'projectSession',
      dispose: () => {
        disposed = true
        stopWatchingLibraries?.()
        goneListeners.clear()
      },
      providesServices: [
        provideService(projectSessionService, {
          current: computed(() => current.value),
          opening: computed(() => opening.value),
          error: computed(() => error.value),
          open,
          close,
          onProjectGone: (listener) => {
            goneListeners.add(listener)
            return () => goneListeners.delete(listener)
          },
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
          /*
           * Routed through the buffer, not a view: undo has to work whether or
           * not the editor pane happens to be mounted.
           *
           * And it asks the project's undo stack first, for the same reason the
           * editor capability does — otherwise `⌘Z` would undo a three-file
           * operation whole with the editor focused and a third of it from the
           * feature tree, which is a worse rule than either behaviour alone.
           */
          run: () => {
            const session = current.peek()
            const buffer = session?.activeBuffer.peek()
            if (buffer === null || buffer === undefined) return

            const history = ctx.services.optional(projectHistoryService) ?? null
            const action = projectActionToUndo({
              history,
              path: session?.relativePathFor(buffer) ?? null,
              undoDepth: undoDepth(buffer.state.peek()),
            })
            if (action !== null && history !== null) {
              history.revert(action.id)
              return
            }

            buffer.runCommand(undo)
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
