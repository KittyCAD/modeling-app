import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Project } from '@src/lib/project'
import type { HomeProjectEntryContribution } from '@src/registry/contracts/homeProjects'

export interface SystemIORegistryService {
  request: <TRequest extends SystemIORequest>(
    request: TRequest
  ) => Promise<SystemIORequestResult<TRequest>>
  stateSignal: ReadonlySignal<SystemIOState>
  localProjectEntriesSignal: ReadonlySignal<HomeProjectEntryContribution[]>
  refreshLocalProjects: (
    projectDirectoryPath?: string
  ) => Promise<HomeProjectEntryContribution[]>
  markCurrentProjectTreeDirty: () => void
}

export const systemIOContract = defineContract({
  systemIOService: defineService<SystemIORegistryService>('system-io'),
})

export const { systemIOService } = systemIOContract

export type SystemIOOperationStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'

export interface SystemIOOperationSummary {
  id: number
  type: SystemIORequest['type']
  resourceKey: string
  status: SystemIOOperationStatus
  startedAt?: number
  completedAt?: number
  error?: unknown
}

export interface SystemIOState {
  operations: readonly SystemIOOperationSummary[]
  runningCount: number
  localProjectsLoaded: boolean
  localProjectIndexStatus: SystemIOOperationStatus | 'idle'
  canReadWriteProjectDirectory: { value: boolean; error: unknown }
  currentProjectTreeVersion: number
}

export type RequestedKCLFile = {
  requestedProjectName: string
  requestedFileName: string
  requestedCode: string
}

export type RequestedKCLFileDelete = {
  requestedFileName: string
}

export type RequestedProjectFile = {
  requestedProjectName: string
  requestedFileName: string
  requestedData: Uint8Array<ArrayBuffer>
}

export type SystemIORequest =
  | {
      type: 'localProjects.index'
      projectDirectoryPath?: string
    }
  | {
      type: 'project.loadTree'
      projectPath: string
    }
  | {
      type: 'project.create'
      requestedProjectName: string
    }
  | {
      type: 'project.rename'
      projectName: string
      requestedProjectName: string
    }
  | {
      type: 'project.delete'
      projectName: string
    }
  | {
      type: 'file.createKCL'
      requestedProjectName?: string
      requestedSubDirectory?: string
      requestedFileNameWithExtension: string
      requestedCode: string
    }
  | {
      type: 'files.bulkCreateKCL'
      files: RequestedKCLFile[]
      requestedProjectName?: string
      requestedFileNameWithExtension?: string
      override?: boolean
    }
  | {
      type: 'project.importFiles'
      files: RequestedProjectFile[]
      requestedProjectName: string
      requestedFileNameWithExtension?: string
    }
  | {
      type: 'files.bulkCreateAndDeleteKCL'
      files: RequestedKCLFile[]
      filesToDelete?: RequestedKCLFileDelete[]
      requestedProjectName: string
      requestedFileNameWithExtension: string
      override?: boolean
    }
  | {
      type: 'file.deleteKCL'
      requestedProjectName: string
      requestedFileName: string
    }
  | {
      type: 'folder.rename'
      folderName: string
      requestedFolderName: string
      absolutePathToParentDirectory: string
    }
  | {
      type: 'file.rename'
      fileNameWithExtension: string
      requestedFileNameWithExtension: string
      absolutePathToParentDirectory: string
    }
  | {
      type: 'path.delete'
      requestedPath: string
      requestedProjectName?: string
    }
  | {
      type: 'file.createBlank'
      requestedAbsolutePath: string
    }
  | {
      type: 'folder.createBlank'
      requestedAbsolutePath: string
    }
  | {
      type: 'path.copyRecursive'
      src: string
      target: string
    }
  | {
      type: 'path.moveRecursive'
      src: string
      target: string
      successMessage?: string
      requestedProjectName?: string
    }
  | {
      type: 'directory.checkReadWrite'
      projectDirectoryPath?: string
    }

export type SystemIORequestResult<TRequest extends SystemIORequest> =
  TRequest extends { type: 'localProjects.index' }
    ? HomeProjectEntryContribution[]
    : TRequest extends { type: 'project.loadTree' }
      ? Project
      : TRequest extends { type: 'project.create' }
        ? { message: string; name: string; projectPath: string }
        : TRequest extends { type: 'project.rename' }
          ? { message: string; oldName: string; newName: string }
          : TRequest extends { type: 'project.delete' }
            ? { message: string; name: string }
            : TRequest extends { type: 'directory.checkReadWrite' }
              ? { value: boolean; error: unknown }
              : {
                  message: string
                  projectName?: string
                  fileName?: string
                  requestedAbsolutePath?: string
                  requestedPath?: string
                  target?: string
                  shouldNavigate?: boolean
                }
