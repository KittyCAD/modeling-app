import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { EditorBuffer } from '@src/contracts/buffers'
import type { ProjectFile, ProjectSummary } from '@src/contracts/projects'

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
  readonly project: ReadonlySignal<ProjectSummary>
  readonly files: ReadonlySignal<readonly ProjectFile[]>
  readonly filesState: ReadonlySignal<'loading' | 'ready' | 'error'>

  readonly buffers: ReadonlySignal<readonly EditorBuffer[]>
  /** The buffer on screen. Null is a normal state, not an error. */
  readonly activeBuffer: ReadonlySignal<EditorBuffer | null>
  /** The buffer feeding the modelling engine. May differ from the active one. */
  readonly executingBuffer: ReadonlySignal<EditorBuffer | null>

  openFile(path: string): Promise<EditorBuffer>
  closeBuffer(bufferId: string): void
  setActiveBuffer(bufferId: string | null): void
  setExecutingBuffer(bufferId: string | null): void
  refreshFiles(): Promise<void>
}

export interface ProjectSessionService {
  /** Null when no project is open — the home screen's condition. */
  readonly current: ReadonlySignal<ProjectSession | null>
  readonly opening: ReadonlySignal<string | null>
  readonly error: ReadonlySignal<string | null>
  open(projectId: string): Promise<ProjectSession | null>
  close(): void
}

export const projectSessionContract = defineContract({
  projectSessionService: defineService<ProjectSessionService>(
    'projectSession.service'
  ),
})

export const { projectSessionService } = projectSessionContract
