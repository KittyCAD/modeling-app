import { defineContract, defineService } from '@kittycad/registry'
import type { Signal } from '@preact/signals-core'
import type {
  KclManager,
  ZDSProject,
  ZDSProjectFileSystemOperations,
} from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'

export type ProjectSessionMutationOperation =
  | 'refresh-project-tree'
  | 'open-editor'
  | 'close-editor'
  | 'close-all-editors'
  | 'create-file'
  | 'write-file'
  | 'create-folder'
  | 'rename-entry'
  | 'delete-entry'
  | 'copy-entry'
  | 'move-entry'
  | 'archive-entry'
  | 'apply-file-patch'

export interface ProjectSessionMutationState {
  readonly pending: boolean
  readonly operation?: ProjectSessionMutationOperation
  readonly targetPath?: string
  readonly lastTargetPath?: string
}

export interface ProjectSessionOpenEditorInput {
  readonly path: string
  readonly editor?: KclManager
  readonly code?: string
  readonly isExecuting?: boolean
}

export interface ProjectSessionFileWriteInput {
  readonly path: string
  readonly contents?: string | Uint8Array<ArrayBuffer>
  readonly overwrite?: boolean
  readonly useDefaultKclContents?: boolean
}

export interface ProjectSessionEntryPathInput {
  readonly path: string
}

export interface ProjectSessionEntryRenameInput {
  readonly oldPath: string
  readonly newPath: string
}

export interface ProjectSessionEntryCopyMoveInput {
  readonly sourcePath: string
  readonly targetPath: string
}

export interface ProjectSessionArchiveEntryResult {
  readonly archivedPath: string
}

export interface ProjectSessionFilePatchEntry {
  readonly path: string
  readonly contents: string | null
}

export interface ProjectSessionApplyFilePatchInput {
  readonly files: readonly ProjectSessionFilePatchEntry[]
}

/**
 * Owns the currently opened project session.
 *
 * This replaces the App-level `project`, `projectSignal`, and selected
 * project-library id state so consumers can depend on a registry service.
 */
export interface ProjectSessionService {
  readonly project: Signal<ZDSProject | undefined>
  readonly projectTree: Signal<Project | undefined>
  readonly currentProjectLibraryId: Signal<string | undefined>
  readonly mutation: Signal<ProjectSessionMutationState>
  getProject: () => ZDSProject | undefined
  getFileSystemOperations: () => ZDSProjectFileSystemOperations
  setProject: (project: ZDSProject | undefined) => void
  clearProject: () => void
  getProjectTree: () => Project | undefined
  refreshProjectTree: () => Promise<Project | undefined>
  openEditor: (input: ProjectSessionOpenEditorInput) => Promise<KclManager>
  closeEditor: (input: ProjectSessionEntryPathInput) => void
  closeAllEditors: () => void
  createFile: (input: ProjectSessionFileWriteInput) => Promise<string>
  writeFile: (input: ProjectSessionFileWriteInput) => Promise<string>
  createFolder: (input: ProjectSessionEntryPathInput) => Promise<string>
  renameEntry: (input: ProjectSessionEntryRenameInput) => Promise<string>
  deleteEntry: (input: ProjectSessionEntryPathInput) => Promise<string>
  copyEntry: (input: ProjectSessionEntryCopyMoveInput) => Promise<string>
  moveEntry: (input: ProjectSessionEntryCopyMoveInput) => Promise<string>
  archiveEntry: (
    input: ProjectSessionEntryPathInput
  ) => Promise<ProjectSessionArchiveEntryResult>
  applyFilePatch: (input: ProjectSessionApplyFilePatchInput) => Promise<void>
  getCurrentProjectLibraryId: () => string | undefined
  setCurrentProjectLibraryId: (libraryId: string | undefined) => void
}

export const projectSessionContract = defineContract({
  projectSession: defineService<ProjectSessionService>('project-session'),
})

export const { projectSession } = projectSessionContract
