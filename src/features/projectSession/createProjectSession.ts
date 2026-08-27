import type { Extension } from '@codemirror/state'
import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type {
  BufferId,
  EditorCapabilityResolver,
  FileBackedTextBuffer,
} from '@src/contracts/buffers'
import type { FileSystem } from '@src/contracts/fileSystem'
import type { ProjectFile } from '@src/contracts/projects'
import type {
  BufferReconcileReport,
  ProjectSession,
  ProjectSnapshot,
} from '@src/contracts/projectSession'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { joinPath, normalizePath, relativePath } from '@src/lib/paths'
import { languageForPath, readProjectFileTree } from '@src/lib/projectFiles'
import type {
  ProjectLibrary,
  ProjectLibraryRealization,
} from '@src/lib/projectLibraries'

export interface ProjectSessionDependencies {
  fileSystem: FileSystem
  capabilities: EditorCapabilityResolver
  themes: readonly Extension[]
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
 * Opening a project deliberately opens no buffer. "No active buffer" is a state
 * the UI has to handle anyway, so it is where you land.
 */
export function createProjectSession(
  realization: ProjectLibraryRealization,
  library: ProjectLibrary | undefined,
  dependencies: ProjectSessionDependencies
): ProjectSession {
  const { fileSystem, capabilities, themes } = dependencies

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
      executingBufferId.value = null
    }

    // Disposing runs the capability bindings' teardown, which is where a pending
    // autosave gets flushed. Closing a buffer must not lose the last keystroke.
    target.dispose()
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
    captureSnapshot,
    reconcileExternalChange,
  }
}
