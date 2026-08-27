import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { EditorBuffer } from '@src/contracts/buffers'
import type {
  ProjectFile,
  ProjectSource,
  ProjectSummary,
} from '@src/contracts/projects'
import type { ProjectSession } from '@src/contracts/projectSession'

/** Maps an extension to the language id that selects editor capabilities. */
function languageFor(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (extension) {
    case 'kcl':
      return 'kcl'
    case 'md':
      return 'markdown'
    case 'toml':
      return 'toml'
    case 'json':
      return 'json'
    default:
      return 'plaintext'
  }
}

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
    name: computed(() => {
      const current = pathSignal.value
      return current.slice(current.lastIndexOf('/') + 1)
    }),
    languageId: languageFor(path),
    text: computed(() => textSignal.value),
    dirty: computed(() => textSignal.value !== baseText.value),
    version: computed(() => version.value),
    setText(next: string) {
      textSignal.value = next
      version.value += 1
    },
  }
}

/** Flatten the tree so a path lookup does not have to walk it every time. */
function flatten(files: readonly ProjectFile[]): ProjectFile[] {
  return files.flatMap((file) =>
    file.kind === 'directory' ? flatten(file.children ?? []) : [file]
  )
}

/**
 * One open project.
 *
 * Everything project-wide lives here: the file listing, the open buffers, and
 * which buffer is being viewed versus executed. Those last two are separate
 * signals rather than one "current file", because collapsing them is what
 * turns the active file into a hidden dependency of every subsystem and makes
 * it impossible to read a second file without disturbing the model.
 *
 * Opening a project deliberately opens no buffer. "No active buffer" is a
 * normal state the UI has to handle anyway, so it is the state you land in.
 */
export function createProjectSession(
  summary: ProjectSummary,
  source: ProjectSource
): ProjectSession {
  const project = signal(summary)
  const files = signal<readonly ProjectFile[]>([])
  const filesState = signal<'loading' | 'ready' | 'error'>('loading')
  const buffers = signal<readonly MutableBuffer[]>([])
  const activeBufferId = signal<string | null>(null)
  const executingBufferId = signal<string | null>(null)

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
      files.value = await source.listFiles(project.peek().id)
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

    const text = await source.readFile(project.peek().id, path)
    const buffer = createBuffer(path, text)
    buffers.value = [...buffers.peek(), buffer]
    activeBufferId.value = buffer.id

    // The first KCL file opened becomes the executing buffer, because a
    // project with geometry and nothing executing is a worse default than
    // guessing. Any later choice is the user's.
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

/** Exposed for the explorer, which needs a flat path list to match against. */
export { flatten as flattenProjectFiles }
