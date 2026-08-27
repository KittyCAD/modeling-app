import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type {
  BufferId,
  BufferSnapshot,
  FileBackedTextBuffer,
} from '@src/contracts/buffers'
import type { ProjectFile } from '@src/contracts/projects'
import type {
  ProjectLibrary,
  ProjectLibraryRealization,
} from '@src/lib/projectLibraries'

/**
 * One open project.
 *
 * The session is the home of everything project-wide: which files exist, which
 * buffers are open, which one is being viewed, and which one is being executed.
 * Single-file edits belong to the buffer; anything spanning files or touching
 * the filesystem belongs here.
 *
 * Viewing and executing are deliberately separate. Conflating them is what
 * makes "the current file" a hidden dependency of every subsystem, and it is
 * why you cannot look at a second file without disturbing the model.
 */
export interface ProjectSession {
  /** The project folder this session is open on. */
  readonly project: ReadonlySignal<ProjectLibraryRealization>
  /** The library it was opened through. Undefined if that library went away. */
  readonly library: ReadonlySignal<ProjectLibrary | undefined>
  readonly files: ReadonlySignal<readonly ProjectFile[]>
  readonly filesState: ReadonlySignal<'loading' | 'ready' | 'error'>

  readonly buffers: ReadonlySignal<readonly FileBackedTextBuffer[]>
  /** The buffer on screen. Null is a normal state, not an error. */
  readonly activeBuffer: ReadonlySignal<FileBackedTextBuffer | null>
  /** The buffer feeding the modelling engine. May differ from the active one. */
  readonly executingBuffer: ReadonlySignal<FileBackedTextBuffer | null>

  /**
   * Open a file, or return the buffer already open for it.
   *
   * `path` is project-relative. Every file type takes this one path — KCL,
   * markdown, TOML, plaintext — so nothing downstream branches on which.
   */
  openFile(path: string): Promise<FileBackedTextBuffer>
  /** A buffer with no file behind it. Never autosaved. */
  openScratch(options?: {
    languageId?: string
    contents?: string
  }): FileBackedTextBuffer
  buffer(bufferId: BufferId): FileBackedTextBuffer | undefined
  /** The buffer open for a project-relative path, if any. */
  bufferForPath(path: string): FileBackedTextBuffer | undefined
  closeBuffer(bufferId: BufferId): void
  setActiveBuffer(bufferId: BufferId | null): void
  setExecutingBuffer(bufferId: BufferId | null): void
  /** Move a buffer to a new path without changing its identity. */
  renameBufferPath(bufferId: BufferId, nextPath: string): void
  refreshFiles(): Promise<void>

  /**
   * Capture the project as it stands, including unsaved edits.
   *
   * Synchronous and O(1) per buffer: CodeMirror documents are persistent, so the
   * capture stays valid while the user keeps typing. This is what lets commit,
   * export, and analysis read the project without a "save all" first.
   */
  captureSnapshot(): ProjectSnapshot

  /**
   * Fold an external version of a file into whatever buffer holds it.
   *
   * Returns null when no buffer has that path, meaning the caller can treat it
   * as a plain filesystem change.
   */
  reconcileExternalChange(input: {
    path: string
    contents: string
  }): BufferReconcileReport | null
}

export interface BufferReconcileReport {
  bufferId: BufferId
  path: string
  outcome: 'unchanged' | 'adopted' | 'diverged'
}

/**
 * The project at one instant.
 *
 * `operationId` is shared by everything derived from this capture, so a commit,
 * an upload, and a completion notification can all be attributed to one
 * operation rather than correlated by timestamp.
 */
export interface ProjectSnapshot {
  operationId: string
  capturedAt: number
  projectPath: string
  buffers: readonly BufferSnapshot[]
}

export interface ProjectSessionService {
  /** Null when no project is open — the home screen's condition. */
  readonly current: ReadonlySignal<ProjectSession | null>
  readonly opening: ReadonlySignal<string | null>
  readonly error: ReadonlySignal<string | null>
  /** `projectId` is a realization id, as minted by the libraries service. */
  open(projectId: string): Promise<ProjectSession | null>
  close(): void
}

export const projectSessionContract = defineContract({
  projectSessionService: defineService<ProjectSessionService>(
    'projectSession.service'
  ),
})

export const { projectSessionService } = projectSessionContract
