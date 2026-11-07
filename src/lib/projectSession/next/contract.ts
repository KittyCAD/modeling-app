import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Project } from '@src/lib/projectSession/next/types'
import type { FileEntry } from '@src/lib/project'

/** File capabilities captured for one project opening; paths are project-relative. */
export interface ProjectFiles {
  read: (relativePath: string) => Promise<string>
  write: (relativePath: string, contents: string) => Promise<void>
}

/**
 * Captures a project and its file capabilities for asynchronous work.
 * Changing the selection leaves existing references bound to their original project.
 */
export interface OpenProjectSession {
  /** Aborted when this opening is closed or replaced; editor/runtime resources share this lifetime. */
  readonly signal: AbortSignal
  readonly project: ReadonlySignal<Project>
  readonly files: ProjectFiles
}

/** Experimental project route state, independent of the existing editor session. */
export interface ProjectSessionService {
  /** Selection for views. Project operations receive a captured session instead. */
  readonly currentSession: ReadonlySignal<OpenProjectSession | undefined>
  readonly currentProject: ReadonlySignal<Project | undefined>
  /** Flatten the current project's file tree, excluding directories; no filesystem I/O. */
  listFiles: () => readonly FileEntry[]
  openProject: (project: Project) => OpenProjectSession
  /** Clear the selection; captured sessions remain usable. */
  closeProject: () => void
}

export const projectSessionContract = defineContract({
  projectSessionService: defineService<ProjectSessionService>(
    'project-session-next'
  ),
})

export const { projectSessionService } = projectSessionContract
