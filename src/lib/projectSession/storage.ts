import { inputs, observe } from '@src/registry/inputs'
import type { ReadonlySignal } from '@preact/signals-core'
import type { TextFileIO } from '@src/lib/projectSession/textFileIO'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { Facet } from 'plankton'
export type ProjectWriteAvailability =
  | {
      readonly writable: true
    }
  | {
      readonly writable: false
      readonly reason: string
    }

/** A deletion retained only by the current session's in-memory undo history. */
export interface StorageDeletion {
  undo: () => Promise<void>
  redo: () => Promise<void>
}
export interface ProjectDeletion extends StorageDeletion {
  readonly projectPath: string
}

/** Storage behavior captured for one project, independent of its presentation or backing. */
export interface ProjectStorage {
  readonly root: string
  readonly writeAvailability: ReadonlySignal<ProjectWriteAvailability>
  readonly saveState?: ReadonlySignal<
    | {
        readonly state: 'saved' | 'saving' | 'failed'
      }
    | undefined
  >
  /** Snapshot backings rebuild and execute the complete project after external changes. */
  readonly externalChanges: 'files' | 'snapshot'
  removeWithHistory: (path: string) => Promise<StorageDeletion>
  readonly createMissingEntrypoint: boolean
  watch: (
    path: string,
    key: string,
    onEvent: Parameters<TextFileIO['watch']>[2]
  ) => () => void
  batch: <T>(
    path: string,
    run: (operations: FileOperationsRegistryService) => Promise<T>
  ) => Promise<T>
  /** Report when adopted contents need the project to rebuild its Rust snapshot. */
  refresh: (
    isCurrent: () => boolean,
    revision?: string
  ) => Promise<{ readonly refreshed: boolean } | undefined>
  retry: () => Promise<void>
  editorChanged: (path: string) => void
  writeThumbnail: (bytes: Uint8Array) => Promise<void>
}
export const projectStorageProvidersFacet = new Facet<
  (path: string) => ProjectStorage | undefined,
  readonly ((path: string) => ProjectStorage | undefined)[]
>('project-session.storage-providers', (inputs) => inputs)

export const observations = inputs({
  projectStorageProvidersFacet: observe(projectStorageProvidersFacet),
})
