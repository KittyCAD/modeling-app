import type { ReadonlySignal } from '@preact/signals'

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * A file or directory inside an open project.
 *
 * Paths are relative to the project root, so a project can be moved between
 * libraries without rewriting anything that refers to its contents.
 */
export interface ProjectFile {
  path: string
  name: string
  kind: 'file' | 'directory'
  children?: ProjectFile[]
}

export interface ProjectFileTree {
  readonly files: ReadonlySignal<readonly ProjectFile[]>
  readonly state: ReadonlySignal<'loading' | 'ready' | 'error'>
}
