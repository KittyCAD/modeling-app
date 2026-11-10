import { appendValueSpec } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { TextFileIO } from '@src/lib/projectSession/textFileIO'

export type ProjectWriteAvailability =
  | { readonly writable: true }
  | { readonly writable: false; readonly reason: string }

/** Storage behavior captured for one project, independent of its presentation or backing. */
export interface ProjectStorage {
  readonly root: string
  readonly writeAvailability: ReadonlySignal<ProjectWriteAvailability>
  readonly saveState?: ReadonlySignal<
    { readonly state: 'saved' | 'saving' | 'failed' } | undefined
  >
  /** Snapshot backings rebuild and execute the complete project after external changes. */
  readonly externalChanges: 'files' | 'snapshot'
  readonly deletionHistory: 'archive' | 'storage'
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
  refresh: (isCurrent: () => boolean, revision?: string) => Promise<void>
  retry: () => Promise<void>
  editorChanged: (path: string) => void
  writeThumbnail: (bytes: Uint8Array) => Promise<void>
}

export const projectStorageProvidersValueSpec = appendValueSpec<
  (path: string) => ProjectStorage | undefined
>('project-session.storage-providers')
