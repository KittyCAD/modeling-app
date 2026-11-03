import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal, Signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lib/projectSession'
import type { TextFileIO } from '@src/lib/projectSession/textFileIO'

export interface ExecutingEditorUpdateOptions {
  shouldExecute?: boolean
  shouldResetCamera?: boolean
  shouldWriteToDisk?: boolean
  shouldAddToHistory?: boolean
  shouldClearHistory?: boolean
}

/** Narrow execution and status capabilities of the session's current editor. */
export interface ExecutingEditor {
  readonly code: ReadonlySignal<string>
  readonly hasEditsSinceLastExecution: ReadonlySignal<boolean>
  readonly isExecuting: ReadonlySignal<boolean>
  /** Null before the first execution; retains the final duration afterward. */
  readonly executionElapsedMs: ReadonlySignal<number | null>
  readonly selectionStatusLabel: ReadonlySignal<string>
  readonly showExperimentalFeaturesStatusBarItem: ReadonlySignal<boolean>
  getPendingCommandCount(): number
  executeCode(code?: string): Promise<void>
  updateCode(code: string, options?: ExecutingEditorUpdateOptions): void
}

/**
 * Owns the currently opened project session.
 *
 * This is the registry replacement target for `App.project`,
 * `App.projectSignal`, and the selected project-library id. The legacy App
 * fields delegate to this service while call sites are migrated.
 */
export interface ProjectSessionService {
  readonly textFileIO: TextFileIO
  /** The current editor capability; absent when the session has no executing editor. */
  readonly executingEditor: ReadonlySignal<ExecutingEditor | undefined>
  readonly project: Signal<ZDSProject | undefined>
  readonly currentProjectLibraryId: Signal<string | undefined>
  getProject: () => ZDSProject | undefined
  setProject: (project: ZDSProject | undefined) => void
  clearProject: () => void
  getCurrentProjectLibraryId: () => string | undefined
  setCurrentProjectLibraryId: (libraryId: string | undefined) => void
}

export const projectSessionContract = defineContract({
  projectSession: defineService<ProjectSessionService>('project-session'),
})

export const { projectSession } = projectSessionContract
