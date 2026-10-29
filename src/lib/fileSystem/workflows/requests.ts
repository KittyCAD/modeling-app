import type { Project } from '@src/lib/project'
import type { FileWorkflowEvents } from '@src/lib/fileSystem/workflows/events'
import type {
  RequestedKCLFile,
  RequestedKCLFileDelete,
  RequestedProjectFile,
  BulkFileWriteProgress,
} from '@src/lib/fileSystem/workflows/utils'
type WorkflowRequest =
  | {
      type: FileWorkflowEvents.readFoldersFromProjectDirectory
    }
  | {
      type: FileWorkflowEvents.done_readFoldersFromProjectDirectory
      output: Project[]
    }
  | {
      type: FileWorkflowEvents.setFolders
      data: { folders: Project[] }
    }
  | {
      type: FileWorkflowEvents.done_checkReadWrite
      output: { value: boolean; error: unknown }
    }
  | {
      type: FileWorkflowEvents.setProjectDirectoryPath
      data: { requestedProjectDirectoryPath: string }
    }
  | {
      type: FileWorkflowEvents.navigateToProject
      data: { requestedProjectName: string }
    }
  | {
      type: FileWorkflowEvents.navigateToFile
      data: {
        requestedProjectName: string
        requestedFileName: string
        requestedSubRoute?: string
        onProjectLoaderComplete?: () => void
      }
    }
  | {
      type: FileWorkflowEvents.createProject
      data: {
        /** Local project directory name used as the stable identifier. */
        requestedProjectName: string
        /** Human-facing project title to write to project.toml. */
        requestedProjectTitle?: string
      }
    }
  | {
      type: FileWorkflowEvents.duplicateProject
      data: {
        projectName: string
        projectPath: string
        requestedProjectName: string
        currentFilePath?: string | null
        currentFileContents?: string
      }
    }
  | {
      type: FileWorkflowEvents.renameProject
      data: {
        /** New human-facing project title to write to project.toml. */
        requestedProjectName: string
        /** Existing local project directory name used as the stable identifier. */
        projectName: string
        redirect: boolean
      }
    }
  | {
      type: FileWorkflowEvents.done_renameProject
      output: { redirect: boolean; newName: string }
    }
  | {
      type: FileWorkflowEvents.deleteProject
      data: { requestedProjectName: string }
    }
  | {
      type: FileWorkflowEvents.done_deleteProject
      output: { message: string; name: string }
    }
  | {
      type: FileWorkflowEvents.createKCLFile
      data: {
        requestedProjectName: string
        requestedSubDirectory?: string
        requestedFileNameWithExtension: string
        requestedCode: string
      }
    }
  | {
      type: FileWorkflowEvents.bulkCreateKCLFiles
      data: {
        files: RequestedKCLFile[]
      }
    }
  | {
      type: FileWorkflowEvents.bulkCreateKCLFilesAndNavigateToProject
      data: {
        files: RequestedKCLFile[]
        requestedProjectName: string
        override?: boolean
        requestedSubRoute?: string
      }
    }
  | {
      type: FileWorkflowEvents.bulkImportProjectFilesAndNavigateToFile
      data: {
        files: RequestedProjectFile[]
        requestedProjectName: string
        requestedFileNameWithExtension?: string
        requestedSubRoute?: string
      }
    }
  | {
      type: FileWorkflowEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile
      data: {
        orderedId?: number
        files: RequestedKCLFile[]
        filesToDelete?: RequestedKCLFileDelete[]
        requestedProjectName: string
        requestedProjectPath?: string
        requestedFileNameWithExtension: string
        override?: boolean
        requestedSubRoute?: string
        onFileSystemError?: () => void
        onFileWriteProgress?: (progress: BulkFileWriteProgress) => void
        onFileSystemSuccess?: () => void
        onSuccess?: () => void
      }
    }
  | {
      type: FileWorkflowEvents.bulkCreateKCLFilesAndNavigateToFile
      data: {
        files: RequestedKCLFile[]
        requestedProjectName: string
        requestedFileNameWithExtension: string
        override?: boolean
        requestedSubRoute?: string
        onSuccess?: () => void
      }
    }
  | {
      type: FileWorkflowEvents.done_bulkCreateKCLFilesAndNavigateToFile
      output: {
        projectName: string
        fileName: string
        subRoute?: string
        onProjectLoaderComplete?: () => void
      }
    }
  | {
      type: FileWorkflowEvents.done_bulkCreateAndDeleteKCLFilesAndNavigateToFile
      output: {
        projectName: string
        fileName: string
        shouldNavigate: boolean
        onProjectLoaderComplete?: () => void
        message?: string
        toastId?: string
      }
    }
  | {
      type: FileWorkflowEvents.importFileFromURL
      data: {
        requestedProjectName: string
        requestedFileNameWithExtension: string
        requestedCode: string
        requestedSubRoute?: string
      }
    }
  | {
      type: FileWorkflowEvents.done_importFileFromURL
      output: {
        projectName: string
        fileName: string
        subRoute?: string
      }
    }
  | {
      type: FileWorkflowEvents.setDefaultProjectFolderName
      data: { requestedDefaultProjectFolderName: string }
    }
  // TODO: Move this generateZookeeper to another machine in the future and make a whole machine out of it.
  | {
      type: FileWorkflowEvents.generateZookeeper
      data: {
        requestedPrompt: string
        requestedProjectName: string
        isProjectNew: boolean
      }
    }
  | {
      type: FileWorkflowEvents.deleteKCLFile
      data: {
        requestedProjectName: string
        requestedFileName: string
      }
    }
  | {
      type: FileWorkflowEvents.renameFolder
      data: {
        requestedFolderName: string
        folderName: string
        absolutePathToParentDirectory: string
      }
    }
  | {
      type: FileWorkflowEvents.renameFile
      data: {
        requestedFileNameWithExtension: string
        fileNameWithExtension: string
        absolutePathToParentDirectory: string
      }
    }
  | {
      type: FileWorkflowEvents.renameFileAndNavigateToFile
      data: {
        requestedFileNameWithExtension: string
        fileNameWithExtension: string
        absolutePathToParentDirectory: string
      }
    }
  | {
      type: FileWorkflowEvents.done_renameFileAndNavigateToFile
      output: {
        projectName: string
        filePathWithExtensionRelativeToProject: string
      }
    }
  | {
      type: FileWorkflowEvents.deleteFileOrFolder
      data: {
        requestedPath: string
      }
    }
  | {
      type: FileWorkflowEvents.createBlankFile
      data: {
        requestedAbsolutePath: string
      }
    }
  | {
      type: FileWorkflowEvents.createBlankFolder
      data: {
        requestedAbsolutePath: string
      }
    }
  | {
      type: FileWorkflowEvents.renameFolderAndNavigateToFile
      data: {
        requestedFolderName: string
        folderName: string
        absolutePathToParentDirectory: string
        requestedProjectName: string
        requestedFileNameWithExtension: string
      }
    }
  | {
      type: FileWorkflowEvents.done_renameFolderAndNavigateToFile
      output: {
        requestedProjectName: string
        requestedFileNameWithExtension: string
      }
    }
  | {
      type: FileWorkflowEvents.deleteFileOrFolderAndNavigate
      data: {
        requestedPath: string
        requestedProjectName: string
      }
    }
  | {
      type: FileWorkflowEvents.done_deleteFileOrFolderAndNavigate
      output: { requestedProjectName: string }
    }
  | {
      type: FileWorkflowEvents.copyRecursive
      data: {
        src: string
        target: string
      }
    }
  | {
      type: FileWorkflowEvents.moveRecursive
      data: {
        src: string
        target: string
        successMessage?: string
      }
    }
  | {
      type: FileWorkflowEvents.moveRecursiveAndNavigate
      data: {
        src: string
        target: string
        requestedProjectName: string
        requestedFileName?: string
        successMessage?: string
      }
    }
  | {
      type: FileWorkflowEvents.done_moveRecursiveAndNavigate
      output: {
        requestedProjectName: string
        requestedFileName?: string
        target: string
      }
    }

export type FileWorkflowRequest = Exclude<
  WorkflowRequest,
  {
    type:
      | FileWorkflowEvents.done_readFoldersFromProjectDirectory
      | FileWorkflowEvents.done_renameProject
      | FileWorkflowEvents.done_deleteProject
      | FileWorkflowEvents.done_checkReadWrite
      | FileWorkflowEvents.done_importFileFromURL
      | FileWorkflowEvents.done_bulkCreateKCLFilesAndNavigateToFile
      | FileWorkflowEvents.done_bulkCreateAndDeleteKCLFilesAndNavigateToFile
      | FileWorkflowEvents.done_renameFileAndNavigateToFile
      | FileWorkflowEvents.done_renameFolderAndNavigateToFile
      | FileWorkflowEvents.done_deleteFileOrFolderAndNavigate
      | FileWorkflowEvents.done_moveRecursiveAndNavigate
  }
>
