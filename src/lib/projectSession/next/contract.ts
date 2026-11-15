import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Project } from '@src/lib/projectSession/next/types'
import type { FileEntry } from '@src/lib/project'

/** File capabilities captured for one project opening; paths are project-relative. */
export interface ProjectFiles {
  readBytes: (relativePath: string) => Promise<Uint8Array>
  read: (relativePath: string) => Promise<string>
  write: (relativePath: string, contents: string) => Promise<void>
}

/** Captured working bytes for an entrypoint and its project inputs. */
export interface ProjectSourceSnapshot {
  readonly src: string
  readonly files: ReadonlyMap<string, Uint8Array>
}

/** Document overlays and storage reads share the captured project opening. */
export interface ProjectSourcesService {
  readonly revision: ReadonlySignal<unknown>
  capture: (request: {
    document: { readonly src?: string; readonly contents: string }
    unnamedPath: string
    signal: AbortSignal
    include?: (path: string) => boolean
  }) => Promise<ProjectSourceSnapshot | Error>
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
  /** Adopt fresh project data for this opening, preserving its root and storage identity. */
  updateProject: (
    session: OpenProjectSession,
    project: Project
  ) => Error | undefined
  /** Refresh descriptive metadata for the captured opening; closed/replaced openings are ignored. */
  updateMetadata: (
    session: OpenProjectSession,
    metadata: Pick<Project['metadata'], 'title' | 'defaultFile'>
  ) => void
  /** Clear the selection; captured sessions remain usable. */
  closeProject: () => void
}

export const projectSessionContract = defineContract({
  projectSourcesService:
    defineService<ProjectSourcesService>('project-sources'),
  projectSessionService: defineService<ProjectSessionService>(
    'project-session-next'
  ),
})

export const { projectSessionService, projectSourcesService } =
  projectSessionContract
