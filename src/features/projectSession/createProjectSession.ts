import { isolateHistory } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'
import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type {
  BufferId,
  EditorCapabilityResolver,
  FileBackedTextBuffer,
} from '@src/contracts/buffers'
import type { FileSystem } from '@src/contracts/fileSystem'
import type { FileChange, FileWatcher } from '@src/contracts/fileWatcher'
import type { FsOperationQueue } from '@src/contracts/fsOperations'
import type { ProjectFile } from '@src/contracts/projects'
import type {
  BufferReconcileReport,
  ProjectSession,
  ProjectSnapshot,
} from '@src/contracts/projectSession'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { readExternalChange } from '@src/lib/fs/externalChange'
import { dirname, joinPath, normalizePath, relativePath } from '@src/lib/paths'
import { languageForPath, readProjectFileTree } from '@src/lib/projectFiles'
import type {
  ProjectLibrary,
  ProjectLibraryRealization,
} from '@src/lib/projectLibraries'

export interface ProjectSessionDependencies {
  fileSystem: FileSystem
  capabilities: EditorCapabilityResolver
  themes: readonly Extension[]
  /** Write provenance, so the session can ignore its own saves coming back. */
  queue: FsOperationQueue
  /** Absent on platforms with nothing external to watch. */
  watcher?: FileWatcher
  /**
   * What a file created with no content should contain.
   *
   * A dependency rather than a constant because it is *policy*: a new KCL file
   * gets a `@settings` annotation naming the language version and, when it is not
   * the default, the project's unit. That policy needs the settings cascade and a
   * WASM module, neither of which a buffer collection should know about.
   *
   * Absent means empty, which is what it was before: a session with no policy
   * still creates files.
   */
  initialContents?: (path: string) => Promise<string>
}

let operationCounter = 0

/**
 * One open project.
 *
 * Owns the buffer collection and its lifecycle. Buffers are keyed by generated
 * id, never by path, so a rename moves a buffer rather than replacing it and
 * background work holding a reference survives the move.
 *
 * Viewing and executing are separate signals. Collapsing them into one "current
 * file" is what turns the active file into a hidden dependency of every
 * subsystem, and it is why you otherwise cannot read a second file without
 * disturbing the model.
 *
 * Creating a session deliberately opens no buffer. "No active buffer" is a state
 * the UI has to handle anyway, and which file a project starts in is a decision
 * about projects rather than about buffers — it belongs to the caller, so this
 * stays a buffer collection with no default of its own.
 */
export function createProjectSession(
  realization: ProjectLibraryRealization,
  library: ProjectLibrary | undefined,
  dependencies: ProjectSessionDependencies
): ProjectSession {
  const { fileSystem, capabilities, themes, queue, watcher } = dependencies

  const project = signal(realization)
  const librarySignal = signal(library)
  const files = signal<readonly ProjectFile[]>([])
  const filesState = signal<'loading' | 'ready' | 'error'>('loading')
  const buffers = signal<readonly FileBackedTextBuffer[]>([])
  const activeBufferId = signal<BufferId | null>(null)
  const executingBufferId = signal<BufferId | null>(null)

  /** Project-relative to absolute. Only the project root is absolute. */
  const absolutePath = (relative: string) =>
    joinPath(project.peek().path, relative)

  const bufferById = (id: BufferId | null) =>
    id ? (buffers.value.find((buffer) => buffer.id === id) ?? null) : null

  const activeBuffer: ReadonlySignal<FileBackedTextBuffer | null> = computed(
    () => bufferById(activeBufferId.value)
  )
  const executingBuffer: ReadonlySignal<FileBackedTextBuffer | null> = computed(
    () => bufferById(executingBufferId.value)
  )

  const refreshFiles = async () => {
    filesState.value = 'loading'
    try {
      files.value = await readProjectFileTree(fileSystem, project.peek().path)
      filesState.value = 'ready'
    } catch (error) {
      console.error('projectSession: could not list files', error)
      files.value = []
      filesState.value = 'error'
    }
  }

  /** Callers pass project-relative paths; buffers hold absolute ones. */
  const bufferForPath = (path: string) => {
    const absolute = absolutePath(normalizePath(path))
    return buffers.value.find((buffer) => buffer.path.peek() === absolute)
  }

  const relativePathFor = (buffer: FileBackedTextBuffer) => {
    const current = buffer.path.peek()
    if (current === null) return null
    return relativePath(project.peek().path, current) ?? current
  }

  const openFile = async (path: string) => {
    const normalized = normalizePath(path)
    const existing = bufferForPath(normalized)
    if (existing) {
      activeBufferId.value = existing.id
      return existing
    }

    const absolute = absolutePath(normalized)
    const contents = await fileSystem.readTextFile(absolute)
    const buffer = createFileBackedTextBuffer({
      // Absolute: this is the resource capabilities act on. Persistence writes
      // it and an LSP would address it; the relative form is presentation only.
      path: absolute,
      contents,
      // Clean on open: what is on screen is what is on disk.
      baseContent: contents,
      languageId: languageForPath(normalized),
      capabilities,
      themes,
    })

    buffers.value = [...buffers.peek(), buffer]
    activeBufferId.value = buffer.id

    // The first KCL buffer becomes the executing one, because a project with
    // geometry and nothing executing is a worse default than guessing. Any later
    // choice is the user's.
    if (
      buffer.languageId.peek() === 'kcl' &&
      executingBufferId.peek() === null
    ) {
      setExecutingBuffer(buffer.id)
    }

    return buffer
  }

  const openScratch: ProjectSession['openScratch'] = (options = {}) => {
    const buffer = createFileBackedTextBuffer({
      // No path means no persistence capability applies, so it is never written.
      path: null,
      contents: options.contents ?? '',
      languageId: options.languageId ?? 'plaintext',
      capabilities,
      themes,
    })

    buffers.value = [...buffers.peek(), buffer]
    activeBufferId.value = buffer.id
    return buffer
  }

  function setExecutingBuffer(bufferId: BufferId | null) {
    const previous = bufferById(executingBufferId.peek())
    // The executing role is structural, so it is pushed into the buffer rather
    // than only tracked here: capabilities can key off it.
    previous?.setExecuting(false)

    executingBufferId.value = bufferId
    bufferById(bufferId)?.setExecuting(true)
  }

  const closeBuffer = (bufferId: BufferId) => {
    const target = bufferById(bufferId)
    if (!target) return

    const remaining = buffers.peek().filter((buffer) => buffer.id !== bufferId)
    buffers.value = remaining

    if (activeBufferId.peek() === bufferId) {
      // Fall back to the most recently opened buffer, or to nothing at all.
      activeBufferId.value = remaining.at(-1)?.id ?? null
    }
    if (executingBufferId.peek() === bufferId) {
      /*
       * The role is handed on, not dropped.
       *
       * The same rule `openFile` uses when it picks the first KCL buffer: a
       * project with geometry and nothing executing is a worse state than a
       * guess. Closing one file of several should leave the model on screen —
       * dropping the role instead cleared the scene and, worse, took the engine
       * with it, which is a lot to happen because a tab was closed.
       *
       * Nothing to hand it to is a real state, and the one the user means when
       * they close the last of them.
       */
      const heir = remaining.find(
        (buffer) => buffer.languageId.peek() === 'kcl'
      )
      setExecutingBuffer(heir?.id ?? null)
    }

    // Disposing runs the capability bindings' teardown, which is where a pending
    // autosave gets flushed. Closing a buffer must not lose the last keystroke.
    target.dispose()
  }

  /**
   * Buffers whose file lives at or under a project-relative path.
   *
   * "At or under" because a directory operation is one action to the user and a
   * fan-out to us: renaming a folder has to carry every buffer inside it, and
   * deleting one has to close them.
   */
  const buffersUnder = (path: string) => {
    const relative = normalizePath(path)
    const prefix = `${relative}/`

    return buffers.peek().flatMap((buffer) => {
      const current = relativePathFor(buffer)
      if (current === null) return []
      if (current !== relative && !current.startsWith(prefix)) return []
      return [{ buffer, relative: current }]
    })
  }

  /**
   * Wait for writes already queued against these paths.
   *
   * `enqueue` runs operations on one path in submission order, so a no-op is a
   * barrier: it resolves only once everything ahead of it has finished. Needed
   * because a save already in flight for `folder/part.kcl` is keyed on that
   * file, while removing or renaming `folder` is keyed on the folder — nothing
   * orders the two, so without this the write can land after the folder has
   * gone and recreate what it was writing to.
   */
  const settlePaths = async (paths: readonly string[]) => {
    await Promise.all(
      paths.map((path) =>
        queue.enqueue(absolutePath(path), async () => undefined)
      )
    )
  }

  const refuseIfTaken = async (relative: string) => {
    if (await fileSystem.exists(absolutePath(relative))) {
      throw new Error(`"${relative}" already exists.`)
    }
  }

  const createFile: ProjectSession['createFile'] = async (path, contents) => {
    const relative = normalizePath(path)

    /*
     * Asked for before the queue, not inside it.
     *
     * Writing the annotation loads a WASM module the first time, and holding the
     * write lock for the length of a multi-megabyte import would stall every
     * other file operation behind a formatter.
     */
    const initial =
      contents ?? (await dependencies.initialContents?.(relative)) ?? ''

    await queue.enqueue(absolutePath(relative), async () => {
      await refuseIfTaken(relative)
      const parent = dirname(relative)
      // A path naming a directory that is not there yet is a reasonable thing
      // to ask for, and making it is cheaper than making the caller ask twice.
      if (parent && parent !== '.') {
        await fileSystem.makeDirectory(absolutePath(parent))
      }
      await fileSystem.writeTextFile(absolutePath(relative), initial)
    })
    await refreshFiles()
  }

  const createDirectory: ProjectSession['createDirectory'] = async (path) => {
    const relative = normalizePath(path)
    await queue.enqueue(absolutePath(relative), async () => {
      await refuseIfTaken(relative)
      await fileSystem.makeDirectory(absolutePath(relative))
    })
    await refreshFiles()
  }

  const renameEntry: ProjectSession['renameEntry'] = async (from, to) => {
    const source = normalizePath(from)
    const target = normalizePath(to)
    if (source === target) return

    const moving = buffersUnder(source)
    await settlePaths(moving.map((entry) => entry.relative))

    await queue.enqueue(absolutePath(source), async () => {
      await refuseIfTaken(target)
      const parent = dirname(target)
      if (parent && parent !== '.') {
        await fileSystem.makeDirectory(absolutePath(parent))
      }
      await fileSystem.rename(absolutePath(source), absolutePath(target))
    })

    /*
     * The buffers move after the file does, and only if it did.
     *
     * Each keeps its identity, so an unsaved edit, its undo history and the
     * view mounted on it all survive being renamed — which is the whole reason
     * the session owns this rather than the explorer calling the filesystem and
     * hoping.
     */
    for (const { buffer, relative } of moving) {
      const next =
        relative === source
          ? target
          : `${target}${relative.slice(source.length)}`
      buffer.setPath(absolutePath(next))
    }

    await refreshFiles()
  }

  const deleteEntry: ProjectSession['deleteEntry'] = async (path) => {
    const relative = normalizePath(path)
    const doomed = buffersUnder(relative)

    /*
     * Buffers close first, and then their writes are waited for.
     *
     * Closing a buffer flushes a pending autosave — deliberately, so shutting a
     * pane never loses a keystroke — which means closing *after* the removal
     * would write the file back moments after deleting it. This way the save
     * lands, then the file goes: nothing unsaved is lost and nothing comes back.
     */
    for (const { buffer } of doomed) closeBuffer(buffer.id)
    await settlePaths(doomed.map((entry) => entry.relative))

    await queue.enqueue(absolutePath(relative), async () => {
      await fileSystem.remove(absolutePath(relative))
    })

    await refreshFiles()
  }

  const captureSnapshot = (): ProjectSnapshot => {
    operationCounter += 1
    return {
      operationId: `operation-${operationCounter}`,
      capturedAt: Date.now(),
      projectPath: project.peek().path,
      // Synchronous, so no buffer can change between the first capture and the
      // last: observers never see a mixture of old and new project state.
      buffers: buffers.peek().map((buffer) => buffer.snapshot()),
    }
  }

  const applyMutation: ProjectSession['applyMutation'] = async (mutation) => {
    /*
     * First, and not for tidiness. With no restore-from-snapshot API, this
     * capture is the only record of what the project looked like before — so
     * taking it after any step has run would mean a revert reads a document that
     * already includes part of what it is trying to undo.
     */
    const before = captureSnapshot()

    const touched: { bufferId: BufferId; path: string; version: number }[] = []
    const created: string[] = []
    const deleted: string[] = []
    const failed: { path: string; reason: string }[] = []

    const describe = (error: unknown) =>
      error instanceof Error ? error.message : String(error)

    /*
     * Creates before edits, so an edit may target a file this mutation is also
     * introducing. `createFile` refuses a path that is already taken rather than
     * making the name unique, so a collision surfaces here instead of quietly
     * writing somewhere the caller did not name.
     */
    for (const entry of mutation.creates ?? []) {
      try {
        await createFile(entry.path, entry.contents)
        await openFile(entry.path)
        created.push(entry.path)
      } catch (error) {
        failed.push({ path: entry.path, reason: describe(error) })
      }
    }

    const edits = Object.entries(mutation.edits ?? {})
    if (edits.length > 0) {
      /*
       * The executing buffer last. The execution adapter schedules a run off its
       * change, so if that lands before its imports do, the run reads a project
       * that is halfway through being edited.
       */
      const executing = executingBufferId.peek()
      const ordered = [
        ...edits.filter(([path]) => bufferForPath(path)?.id !== executing),
        ...edits.filter(([path]) => bufferForPath(path)?.id === executing),
      ]

      for (const [path, pathEdits] of ordered) {
        const buffer = bufferForPath(path)
        /*
         * Never written behind the session's back. A path with no open buffer is
         * refused rather than saved directly to disk, because a buffer opened
         * later would then hold content that disagrees with the file and nobody
         * would know which was meant.
         */
        if (buffer === undefined) {
          failed.push({ path, reason: 'No buffer is open for this path.' })
          continue
        }
        if (pathEdits.length === 0) continue

        try {
          buffer.dispatch({
            changes: pathEdits.map(({ from, to, insert }) => ({
              from,
              to,
              insert,
            })),
            annotations: [
              bufferOrigin.of(mutation.origin ?? { role: 'project' }),
              // One mutation is one undo step per buffer, not merged with
              // whatever was typed moments before it.
              isolateHistory.of('full'),
            ],
          })
          touched.push({
            bufferId: buffer.id,
            path,
            version: buffer.version.peek(),
          })
        } catch (error) {
          failed.push({ path, reason: describe(error) })
        }
      }
    }

    /*
     * Deletes last, and through `deleteEntry` rather than the filesystem, so they
     * inherit its two orderings: buffers close before the removal so a flushed
     * autosave cannot resurrect the file, and the write queue is settled first so
     * a pending save cannot land after it.
     */
    for (const path of mutation.deletes ?? []) {
      try {
        await deleteEntry(path)
        deleted.push(path)
      } catch (error) {
        failed.push({ path, reason: describe(error) })
      }
    }

    return { before, touched, created, deleted, failed }
  }

  const reconcileExternalChange = ({
    path,
    contents,
  }: {
    path: string
    contents: string
  }): BufferReconcileReport | null => {
    // Accepts either an absolute path or a project-relative one, since watchers
    // report absolute paths and callers in the app think in relative ones.
    const relative =
      relativePath(project.peek().path, path) ?? normalizePath(path)
    const buffer = bufferForPath(relative)
    if (!buffer) return null

    const outcome = buffer.reconcile(contents)
    return { bufferId: buffer.id, path: relative, outcome: outcome.kind }
  }

  /**
   * Fold changes made outside the app into the session.
   *
   * Two separate jobs, and only one of them is about content: a file with a
   * buffer open on it is reconciled, and a file appearing or disappearing
   * changes the tree. A plain write to a file nobody has open changes neither,
   * so it is deliberately not a reason to re-walk the project.
   */
  const applyExternalChanges = async (changes: readonly FileChange[]) => {
    let treeChanged = false

    for (const change of changes) {
      if (change.kind !== 'changed') treeChanged = true

      const buffer = buffers
        .peek()
        .find((candidate) => candidate.path.peek() === change.path)
      if (!buffer) continue

      const external = await readExternalChange(fileSystem, queue, change)
      if (!external) continue

      // Straight to the buffer's own reconciliation, which decides between
      // adopting silently and surfacing a conflict. That policy belongs to the
      // buffer holding the unsaved work, not to whatever noticed the change.
      buffer.reconcile(external.contents)
    }

    if (treeChanged) await refreshFiles()
  }

  const stopWatching = watcher?.watch(project.peek().path, (changes) => {
    void applyExternalChanges(changes).catch((error) => {
      console.error('projectSession: could not apply external changes', error)
    })
  })

  void refreshFiles()

  return {
    project: computed(() => project.value),
    library: computed(() => librarySignal.value),
    files: computed(() => files.value),
    filesState: computed(() => filesState.value),
    buffers: computed(() => buffers.value),
    activeBuffer,
    executingBuffer,

    openFile,
    openScratch,
    buffer: (bufferId) => bufferById(bufferId) ?? undefined,
    bufferForPath,
    closeBuffer,
    setActiveBuffer: (bufferId) => {
      activeBufferId.value = bufferId
    },
    setExecutingBuffer,

    relativePathFor,
    activeBufferPath: computed(() => {
      const buffer = activeBuffer.value
      return buffer ? relativePathFor(buffer) : null
    }),

    renameBufferPath(bufferId, nextPath) {
      // Identity is untouched; only the path metadata moves. Accepts a
      // project-relative path, like every other session API.
      bufferById(bufferId)?.setPath(absolutePath(normalizePath(nextPath)))
    },

    refreshFiles,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    captureSnapshot,
    applyMutation,
    reconcileExternalChange,

    dispose() {
      stopWatching?.()
      // Disposing each buffer runs its capability teardown, which is where a
      // pending autosave gets flushed. Closing a project must not lose the last
      // keystroke any more than closing one file does.
      for (const buffer of buffers.peek()) buffer.dispose()
      buffers.value = []
      activeBufferId.value = null
      executingBufferId.value = null
    },
  }
}
