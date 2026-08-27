import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { EditorBuffer } from '@src/contracts/buffers'
import type { FileSystem } from '@src/contracts/fileSystem'
import type { ProjectFile } from '@src/contracts/projects'
import type { ProjectSession } from '@src/contracts/projectSession'
import { basename, joinPath } from '@src/lib/paths'
import { languageForPath, readProjectFileTree } from '@src/lib/projectFiles'
import type {
  ProjectLibrary,
  ProjectLibraryRealization,
} from '@src/lib/projectLibraries'

interface MutableBuffer extends EditorBuffer {
  setText(next: string): void
}

let bufferCounter = 0

/**
 * Create a buffer for one file.
 *
 * `id` is minted here and never derived from the path, which is what lets a
 * rename move a buffer without anything downstream noticing.
 */
function createBuffer(path: string, text: string): MutableBuffer {
  bufferCounter += 1
  const pathSignal = signal(path)
  const textSignal = signal(text)
  const version = signal(0)
  const baseText = signal(text)

  return {
    id: `buffer-${bufferCounter}`,
    path: computed(() => pathSignal.value),
    name: computed(() => basename(pathSignal.value)),
    languageId: languageForPath(path),
    text: computed(() => textSignal.value),
    dirty: computed(() => textSignal.value !== baseText.value),
    version: computed(() => version.value),
    setText(next: string) {
      textSignal.value = next
      version.value += 1
    },
  }
}

/**
 * One open project.
 *
 * Everything project-wide lives here: the file listing, the open buffers, and
 * which buffer is being viewed versus executed. Those last two are separate
 * signals rather than one "current file", because collapsing them is what turns
 * the active file into a hidden dependency of every subsystem and makes it
 * impossible to read a second file without disturbing the model.
 *
 * Opening a project deliberately opens no buffer. "No active buffer" is a normal
 * state the UI has to handle anyway, so it is the state you land in.
 *
 * File paths in this session are project-relative; the realization's path is the
 * only absolute one, so a project that moves between libraries needs nothing
 * rewritten.
 */
export function createProjectSession(
  realization: ProjectLibraryRealization,
  library: ProjectLibrary | undefined,
  fileSystem: FileSystem
): ProjectSession {
  const project = signal(realization)
  const librarySignal = signal(library)
  const files = signal<readonly ProjectFile[]>([])
  const filesState = signal<'loading' | 'ready' | 'error'>('loading')
  const buffers = signal<readonly MutableBuffer[]>([])
  const activeBufferId = signal<string | null>(null)
  const executingBufferId = signal<string | null>(null)

  const absolutePath = (relative: string) =>
    joinPath(project.peek().path, relative)

  const bufferById = (id: string | null) =>
    id ? (buffers.value.find((buffer) => buffer.id === id) ?? null) : null

  const activeBuffer: ReadonlySignal<EditorBuffer | null> = computed(() =>
    bufferById(activeBufferId.value)
  )
  const executingBuffer: ReadonlySignal<EditorBuffer | null> = computed(() =>
    bufferById(executingBufferId.value)
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

  const openFile = async (path: string) => {
    const existing = buffers
      .peek()
      .find((buffer) => buffer.path.peek() === path)
    if (existing) {
      activeBufferId.value = existing.id
      return existing
    }

    const text = await fileSystem.readTextFile(absolutePath(path))
    const buffer = createBuffer(path, text)
    buffers.value = [...buffers.peek(), buffer]
    activeBufferId.value = buffer.id

    // The first KCL file opened becomes the executing buffer, because a project
    // with geometry and nothing executing is a worse default than guessing. Any
    // later choice is the user's.
    if (buffer.languageId === 'kcl' && executingBufferId.peek() === null) {
      executingBufferId.value = buffer.id
    }

    return buffer
  }

  const closeBuffer = (bufferId: string) => {
    const remaining = buffers.peek().filter((buffer) => buffer.id !== bufferId)
    buffers.value = remaining

    if (activeBufferId.peek() === bufferId) {
      // Fall back to the most recently opened buffer, or to nothing at all.
      activeBufferId.value = remaining.at(-1)?.id ?? null
    }
    if (executingBufferId.peek() === bufferId) {
      executingBufferId.value = null
    }
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
    closeBuffer,
    setActiveBuffer: (bufferId) => {
      activeBufferId.value = bufferId
    },
    setExecutingBuffer: (bufferId) => {
      executingBufferId.value = bufferId
    },
    refreshFiles,
  }
}
