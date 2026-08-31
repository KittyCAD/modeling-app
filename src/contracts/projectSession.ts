import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type {
  BufferId,
  BufferSnapshot,
  FileBackedTextBuffer,
} from '@src/contracts/buffers'
import type { TextEdit } from '@src/contracts/modelingOperations'
import type { ProjectFile } from '@src/contracts/projects'
import type { BufferOriginValue } from '@src/lib/buffers/annotations'
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
   *
   * Buffers themselves hold absolute paths, since that is what capabilities act
   * on; the session is where the two representations meet.
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
  /**
   * A buffer's path relative to the project root.
   *
   * The presentation form: breadcrumbs, the explorer, and the URL all want this
   * rather than an absolute path nobody needs to read.
   */
  relativePathFor(buffer: FileBackedTextBuffer): string | null
  /** The active buffer's project-relative path, for the URL and the top bar. */
  readonly activeBufferPath: ReadonlySignal<string | null>
  closeBuffer(bufferId: BufferId): void
  setActiveBuffer(bufferId: BufferId | null): void
  setExecutingBuffer(bufferId: BufferId | null): void
  /** Move a buffer to a new path without changing its identity. */
  renameBufferPath(bufferId: BufferId, nextPath: string): void
  refreshFiles(): Promise<void>

  /**
   * Create an empty file at a project-relative path.
   *
   * Rejects if anything is already there. Deliberately not "make the name
   * unique and carry on": the caller either typed this name, in which case
   * being told is the only useful answer, or generated it, in which case it
   * knows the siblings and can generate a free one.
   *
   * Parent directories are created as needed, so a path with a folder in it
   * that does not exist yet is a valid thing to ask for.
   */
  createFile(path: string, contents?: string): Promise<void>
  /** Create a directory at a project-relative path. Rejects if it exists. */
  createDirectory(path: string): Promise<void>
  /**
   * Rename or move an entry, and carry any open buffers with it.
   *
   * Works on directories too, in which case every buffer underneath follows —
   * a buffer's identity survives the move, so an unsaved edit and its undo
   * history are still there afterwards.
   */
  renameEntry(from: string, to: string): Promise<void>
  /**
   * Delete an entry, recursively, and close any buffers it held.
   *
   * Goes to the OS trash where the platform has one, which is the only reason
   * this is allowed to be a single click with one confirmation.
   */
  deleteEntry(path: string): Promise<void>

  /**
   * Capture the project as it stands, including unsaved edits.
   *
   * Synchronous and O(1) per buffer: CodeMirror documents are persistent, so the
   * capture stays valid while the user keeps typing. This is what lets commit,
   * export, and analysis read the project without a "save all" first.
   */
  captureSnapshot(): ProjectSnapshot

  /**
   * Apply a change that spans files, or touches the filesystem, as one step.
   *
   * The apply half of a prepared project mutation (#13354) — `captureSnapshot`
   * was the capture half. It belongs here for the session's own stated reason:
   * single-file edits belong to the buffer, anything spanning files belongs to
   * the session.
   *
   * The ordering is load-bearing and none of it is obvious, which is the main
   * argument for having one implementation rather than each caller assembling
   * the steps: the snapshot is taken first so a revert has something to read,
   * creates happen before the edits that might target them, and deletes happen
   * last through `deleteEntry` so they inherit its buffers-close-before-removal
   * ordering and its trip to the OS trash.
   */
  applyMutation(mutation: ProjectMutation): Promise<ProjectMutationResult>

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

  /**
   * Tear the session down.
   *
   * Disposes every buffer, which flushes any pending autosave, and stops
   * watching the project folder. Closing a project without this leaves a watch
   * running against a folder nothing is looking at.
   */
  dispose(): void
}

export interface BufferReconcileReport {
  bufferId: BufferId
  /** Project-relative, for reporting to the user. */
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

/**
 * A change to the project, described rather than performed.
 *
 * Plain data, for the same reason `ProjectEdit` is: a mutation that has not been
 * applied can be shown, refused, or recorded as one history entry, while one that
 * applies itself can only be undone.
 */
export interface ProjectMutation {
  /** Past tense and specific: "Extruded profile001 by 10". For history. */
  label: string
  /**
   * Edits per project-relative path, with offsets against the buffer **as it now
   * stands**.
   *
   * This does not rebase. A caller whose edits were computed against an older
   * document rebases first — see `src/lib/collab/rebase.ts` — because only the
   * caller knows what the edits were measured against.
   */
  edits?: Readonly<Record<string, readonly TextEdit[]>>
  creates?: readonly { path: string; contents: string }[]
  deletes?: readonly string[]
  /**
   * Recorded on every transaction this dispatches, so the work is attributable.
   *
   * Its `contributionId` is minted here when absent, so every dispatch of one
   * mutation shares one — which is what makes the whole mutation undoable as a
   * unit rather than a file at a time.
   */
  origin?: BufferOriginValue
}

/** What a mutation actually managed to do. */
export interface ProjectMutationResult {
  /**
   * The project before anything was applied.
   *
   * Taken first, and the reason the ordering is fixed: it is what a revert reads
   * when there is no restore-from-snapshot API.
   */
  before: ProjectSnapshot
  /**
   * The id every transaction carried, for recording a `ProjectAction`.
   *
   * Returned rather than recorded here: the session knows what it wrote, but the
   * caller is the one that knows what to call it, and a lower layer reaching up
   * to the history service to guess a label would be the wrong direction.
   */
  contributionId: string
  touched: readonly { bufferId: BufferId; path: string; version: number }[]
  created: readonly string[]
  deleted: readonly string[]
  /**
   * Steps that did not land, with a reason.
   *
   * **Partial success is a normal outcome, not an error.** There is deliberately
   * no rollback: a file that was created plus an edit that failed is a state
   * somebody can look at and understand, whereas a half-undone filesystem is not.
   */
  failed: readonly { path: string; reason: string }[]
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
