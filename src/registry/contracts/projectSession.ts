import { defineContract, defineService } from '@kittycad/registry'
import type { Signal } from '@preact/signals-core'
import type { KclManager, ZDSProject } from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'

/**
 * Transitional guard against an older asynchronous project open publishing
 * state after a newer application intent.
 *
 * Remove this callback once projectSession owns ZDSProject and KclManager
 * construction, can build each candidate without mutating shared runtime
 * state, and atomically publishes or discards that candidate at one boundary.
 * Until then, callers must invoke it after asynchronous work and before
 * committing project or editor state.
 */
export type ThrowIfProjectOpenSuperseded = () => void

/**
 * A resolved request to enter a project session.
 *
 * URL parsing and project-root resolution happen before this boundary. The
 * optional editor is restoration detail for the project, not the identity of
 * the application destination.
 */
export interface OpenProjectSessionInput {
  project: Project
  initialEditor?: {
    path: string
    providedEditor?: KclManager
    providedCode?: string
    isExecuting?: boolean
  }
  throwIfSuperseded?: ThrowIfProjectOpenSuperseded
}

export interface OpenProjectSessionResult {
  project: ZDSProject
  editor?: KclManager
}

/** Transitional runtime dependencies while ZDSProject moves out of App. */
export interface ProjectSessionRuntime {
  openProject(
    project: Project,
    throwIfSuperseded: ThrowIfProjectOpenSuperseded
  ): Promise<ZDSProject>
  closeProject(): void
}

/**
 * Owns the currently opened project session.
 *
 * This is the registry replacement target for `App.project`,
 * `App.projectSignal`, and the selected project-library id. The legacy App
 * fields delegate to this service while call sites are migrated.
 */
export interface ProjectSessionService {
  readonly project: Signal<ZDSProject | undefined>
  readonly currentProjectLibraryId: Signal<string | undefined>
  getProject: () => ZDSProject | undefined
  setProject: (project: ZDSProject | undefined) => void
  clearProject: () => void
  getCurrentProjectLibraryId: () => string | undefined
  setCurrentProjectLibraryId: (libraryId: string | undefined) => void
  bindRuntime: (runtime: ProjectSessionRuntime) => () => void
  openProject: (
    input: OpenProjectSessionInput
  ) => Promise<OpenProjectSessionResult>
  closeProject: () => void
}

export const projectSessionContract = defineContract({
  projectSession: defineService<ProjectSessionService>('project-session'),
})

export const { projectSession } = projectSessionContract
