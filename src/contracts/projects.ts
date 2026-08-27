import { appendValueSpec, defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

export interface ProjectSummary {
  /** Stable across renames. Qualified by source, e.g. `local:bracket-v2`. */
  id: string
  name: string
  /** Which source holds it, for display and for routing writes back. */
  sourceId: string
  /** Human-readable location, e.g. a folder path or `Zoo Cloud`. */
  location?: string
  modifiedAt: number
  fileCount: number
  /** Revision count, shown in the sheet card's title block. */
  revision?: number
  previewUrl?: string
}

export interface ProjectFile {
  /** Path relative to the project root, using forward slashes. */
  path: string
  name: string
  kind: 'file' | 'directory'
  children?: ProjectFile[]
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * A place projects come from.
 *
 * The local filesystem, the cloud, and an in-memory fixture are all the same
 * shape, so the home screen never learns where a project lives, and adding a
 * new backend never touches UI.
 */
export interface ProjectSource {
  id: string
  /** Shown when more than one source has projects. */
  label: string
  readonly projects: ReadonlySignal<readonly ProjectSummary[]>
  readonly state: ReadonlySignal<LoadState>
  readonly error: ReadonlySignal<string | null>
  refresh(): Promise<void>
  create(name: string): Promise<ProjectSummary>
  rename(projectId: string, name: string): Promise<void>
  delete(projectId: string): Promise<void>
  listFiles(projectId: string): Promise<readonly ProjectFile[]>
  readFile(projectId: string, path: string): Promise<string>
  writeFile(projectId: string, path: string, contents: string): Promise<void>
}

export interface ProjectCatalog {
  readonly sources: ReadonlySignal<readonly ProjectSource[]>
  /** Every project from every source, newest first. */
  readonly projects: ReadonlySignal<readonly ProjectSummary[]>
  readonly state: ReadonlySignal<LoadState>
  get(projectId: string): ProjectSummary | undefined
  sourceFor(projectId: string): ProjectSource | undefined
  refresh(): Promise<void>
}

export const projectsContract = defineContract({
  projectSourcesValueSpec: appendValueSpec<ProjectSource>('projects.sources'),
  projectCatalogService: defineService<ProjectCatalog>('projects.catalog'),
})

export const { projectSourcesValueSpec, projectCatalogService } = projectsContract
