import { inputs, observeService } from '@src/registry/inputs'
import type { ReadonlySignal } from '@preact/signals-core'
import type { FileEntry } from '@src/lib/project'
import type { Project } from '@src/lib/projectSession/next/types'
import { contract, service } from 'plankton'

/** Storage access bound by `createSession` to one project root. All arguments are project-relative paths checked against that root. */
export interface ProjectFiles {
  readBytes: (relativePath: string) => Promise<Uint8Array>
  read: (relativePath: string) => Promise<string>
  write: (relativePath: string, contents: string) => Promise<void>
}

/** Bytes collected by `ProjectSourcesService.capture`; `src` identifies the entrypoint key in `files`. */
export interface ProjectSourceSnapshot {
  readonly src: string
  readonly files: ReadonlyMap<string, Uint8Array>
}

/** Supplies execution consumers with open-document text in preference to storage, using the project opening captured at the start of `capture`. */
export interface ProjectSourcesService {
  /** Changes when the set of open documents, their text or paths, or the project's file tree changes; consumers can use it to request a fresh capture. */
  readonly revision: ReadonlySignal<unknown>
  capture: (request: {
    /** Explicit run input takes precedence over a live document at the same source path. */
    document: { readonly src?: string; readonly contents: string }
    /** Virtual entrypoint name for an unnamed document, supplied by the language consumer. */
    unnamedPath: string
    /** Cancels this capture independently of project replacement. */
    signal: AbortSignal
    /** Select other project files; the explicit entrypoint is always included. */
    include?: (path: string) => boolean
  }) => Promise<ProjectSourceSnapshot | Error>
}

/**
 * A project opening returned by `ProjectSessionService.openProject`.
 * `files` retains that opening's root even after another project is selected;
 * `signal` lets document/execution owners stop work when the opening is replaced.
 */
export interface OpenProjectSession {
  /** `openProject`/`closeProject` abort the previous opening; editors created in it subscribe to this signal. */
  readonly signal: AbortSignal
  readonly project: ReadonlySignal<Project>
  readonly files: ProjectFiles
}

/** A completed backing operation whose file membership can be recorded without more I/O. */
export type ProjectFileMutation =
  | { type: 'created'; path: string }
  | { type: 'renamed'; source: string; destination: string }

/** Project selection for `/local/:path` and `/project/:id`; the legacy `/file/:id` route retains its separate project service. */
export interface ProjectSessionService {
  /** Selected opening for the project UI; async operations capture this value once rather than selecting a project again after awaiting. */
  readonly currentSession: ReadonlySignal<OpenProjectSession | undefined>
  readonly currentProject: ReadonlySignal<Project | undefined>
  /** Flatten the selected project's recorded `contents` tree into file entries; this does not discover changes on disk. */
  listFiles: () => readonly FileEntry[]
  openProject: (project: Project) => OpenProjectSession
  /** Replace data only for the still-selected `session`; reject a different root or cloud project ID. */
  updateProject: (
    session: OpenProjectSession,
    project: Project
  ) => Error | undefined
  /** Amend this opening's latest file tree after a successful backing operation; stale openings are ignored. */
  applyFileMutation: (
    session: OpenProjectSession,
    mutation: ProjectFileMutation
  ) => Error | undefined
  /** Update the current opening's title/default-file metadata without replacing its file tree; ignore a retired `session`. */
  updateMetadata: (
    session: OpenProjectSession,
    metadata: Pick<Project['metadata'], 'title' | 'defaultFile'>
  ) => void
  /** Clear project selection and abort the opening's signal. Captured `files` still addresses its original root. */
  closeProject: () => void
}
export const projectSessionContract = contract({
  projectSourcesService: service<ProjectSourcesService>('project-sources'),
  projectSessionService: service<ProjectSessionService>('project-session-next'),
})
export const { projectSessionService, projectSourcesService } =
  projectSessionContract

export const observations = inputs({
  projectSourcesService: observeService(projectSourcesService),
  projectSessionService: observeService(projectSessionService),
})
