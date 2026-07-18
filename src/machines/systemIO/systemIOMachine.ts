import type { App } from '@src/lib/app'
import {
  DEFAULT_PROJECT_NAME,
  MAX_PROJECT_NAME_LENGTH,
  ZOOKEEPER_FILE_WRITE_TOAST_ID,
} from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { reportSystemIOMachineError } from '@src/machines/systemIO/reporting'
import type {
  RequestedKCLFile,
  RequestedKCLFileDelete,
  RequestedProjectFile,
  SystemIOContext,
  SystemIOInput,
} from '@src/machines/systemIO/utils'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineActions,
  SystemIOMachineActors,
  SystemIOMachineEvents,
  SystemIOMachineGuards,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import toast from 'react-hot-toast'
import { assertEvent, assign, enqueueActions, fromPromise, setup } from 'xstate'

/**
 * /some/dir            = directoryPath
 * report               = fileNameWithoutExtension
 * report.csv           = fileNameWithExtension
 * /some/dir/report.csv = absolutePathToFileNameWithExtension
 * /some/dir/report     = absolutePathToFileNameWithoutExtension
 * /some/dir/report    = absolutePathToDirectory
 * some/dir/report      = relativePathToDirectory
 * some/dir/report      = relativePathFileWithoutExtension
 */

/**
 * Handles any system level I/O for folders and files
 * This machine will be initializes once within the applications runtime
 * and exist for the entire life cycle of the application and able to be access
 * at a global level.
 */
export const systemIOMachine = setup({
  types: {
    context: {} as SystemIOContext,
    input: {} as SystemIOInput,
    events: {} as
      | {
          type: SystemIOMachineEvents.readFoldersFromProjectDirectory
        }
      | {
          type: SystemIOMachineEvents.done_readFoldersFromProjectDirectory
          output: Project[]
        }
      | {
          type: SystemIOMachineEvents.setFolders
          data: { folders: Project[] }
        }
      | {
          type: SystemIOMachineEvents.done_checkReadWrite
          output: { value: boolean; error: unknown }
        }
      | {
          type: SystemIOMachineEvents.setProjectDirectoryPath
          data: { requestedProjectDirectoryPath: string }
        }
      | {
          type: SystemIOMachineEvents.navigateToProject
          data: { requestedProjectName: string }
        }
      | {
          type: SystemIOMachineEvents.navigateToFile
          data: {
            requestedProjectName: string
            requestedFileName: string
            requestedSubRoute?: string
            onProjectLoaderComplete?: () => void
          }
        }
      | {
          type: SystemIOMachineEvents.createProject
          data: {
            /** Local project directory name used as the stable identifier. */
            requestedProjectName: string
            /** Human-facing project title to write to project.toml. */
            requestedProjectTitle?: string
          }
        }
      | {
          type: SystemIOMachineEvents.renameProject
          data: {
            /** New human-facing project title to write to project.toml. */
            requestedProjectName: string
            /** Existing local project directory name used as the stable identifier. */
            projectName: string
            redirect: boolean
          }
        }
      | {
          type: SystemIOMachineEvents.done_renameProject
          output: { redirect: boolean; newName: string }
        }
      | {
          type: SystemIOMachineEvents.deleteProject
          data: { requestedProjectName: string }
        }
      | {
          type: SystemIOMachineEvents.done_deleteProject
          output: { message: string; name: string }
        }
      | {
          type: SystemIOMachineEvents.createKCLFile
          data: {
            requestedProjectName: string
            requestedSubDirectory?: string
            requestedFileNameWithExtension: string
            requestedCode: string
          }
        }
      | {
          type: SystemIOMachineEvents.bulkCreateKCLFiles
          data: {
            files: RequestedKCLFile[]
          }
        }
      | {
          type: SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToProject
          data: {
            files: RequestedKCLFile[]
            requestedProjectName: string
            override?: boolean
            requestedSubRoute?: string
          }
        }
      | {
          type: SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile
          data: {
            files: RequestedProjectFile[]
            requestedProjectName: string
            requestedFileNameWithExtension?: string
            requestedSubRoute?: string
          }
        }
      | {
          type: SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile
          data: {
            files: RequestedKCLFile[]
            filesToDelete?: RequestedKCLFileDelete[]
            requestedProjectName: string
            requestedFileNameWithExtension: string
            override?: boolean
            requestedSubRoute?: string
            onFileSystemError?: () => void
            onFileSystemSuccess?: () => void
            onSuccess?: () => void
          }
        }
      | {
          type: SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToFile
          data: {
            files: RequestedKCLFile[]
            requestedProjectName: string
            requestedFileNameWithExtension: string
            override?: boolean
            requestedSubRoute?: string
          }
        }
      | {
          type: SystemIOMachineEvents.done_bulkCreateKCLFilesAndNavigateToFile
          output: { projectName: string; fileName: string; subRoute?: string }
        }
      | {
          type: SystemIOMachineEvents.done_bulkCreateAndDeleteKCLFilesAndNavigateToFile
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
          type: SystemIOMachineEvents.importFileFromURL
          data: {
            requestedProjectName: string
            requestedFileNameWithExtension: string
            requestedCode: string
            requestedSubRoute?: string
          }
        }
      | {
          type: SystemIOMachineEvents.done_importFileFromURL
          output: {
            projectName: string
            fileName: string
            subRoute?: string
          }
        }
      | {
          type: SystemIOMachineEvents.setDefaultProjectFolderName
          data: { requestedDefaultProjectFolderName: string }
        }
      // TODO: Move this generateTextToCAD to another machine in the future and make a whole machine out of it.
      | {
          type: SystemIOMachineEvents.generateTextToCAD
          data: {
            requestedPrompt: string
            requestedProjectName: string
            isProjectNew: boolean
          }
        }
      | {
          type: SystemIOMachineEvents.deleteKCLFile
          data: {
            requestedProjectName: string
            requestedFileName: string
          }
        }
      | {
          type: SystemIOMachineEvents.renameFolder
          data: {
            requestedFolderName: string
            folderName: string
            absolutePathToParentDirectory: string
          }
        }
      | {
          type: SystemIOMachineEvents.renameFile
          data: {
            requestedFileNameWithExtension: string
            fileNameWithExtension: string
            absolutePathToParentDirectory: string
          }
        }
      | {
          type: SystemIOMachineEvents.renameFileAndNavigateToFile
          data: {
            requestedFileNameWithExtension: string
            fileNameWithExtension: string
            absolutePathToParentDirectory: string
          }
        }
      | {
          type: SystemIOMachineEvents.done_renameFileAndNavigateToFile
          output: {
            projectName: string
            filePathWithExtensionRelativeToProject: string
          }
        }
      | {
          type: SystemIOMachineEvents.deleteFileOrFolder
          data: {
            requestedPath: string
          }
        }
      | {
          type: SystemIOMachineEvents.createBlankFile
          data: {
            requestedAbsolutePath: string
          }
        }
      | {
          type: SystemIOMachineEvents.createBlankFolder
          data: {
            requestedAbsolutePath: string
          }
        }
      | {
          type: SystemIOMachineEvents.renameFolderAndNavigateToFile
          data: {
            requestedFolderName: string
            folderName: string
            absolutePathToParentDirectory: string
            requestedProjectName: string
            requestedFileNameWithExtension: string
          }
        }
      | {
          type: SystemIOMachineEvents.done_renameFolderAndNavigateToFile
          output: {
            requestedProjectName: string
            requestedFileNameWithExtension: string
          }
        }
      | {
          type: SystemIOMachineEvents.deleteFileOrFolderAndNavigate
          data: {
            requestedPath: string
            requestedProjectName: string
          }
        }
      | {
          type: SystemIOMachineEvents.done_deleteFileOrFolderAndNavigate
          output: { requestedProjectName: string }
        }
      | {
          type: SystemIOMachineEvents.copyRecursive
          data: {
            src: string
            target: string
          }
        }
      | {
          type: SystemIOMachineEvents.moveRecursive
          data: {
            src: string
            target: string
            successMessage?: string
          }
        }
      | {
          type: SystemIOMachineEvents.moveRecursiveAndNavigate
          data: {
            src: string
            target: string
            requestedProjectName: string
            successMessage?: string
          }
        }
      | {
          type: SystemIOMachineEvents.done_moveRecursiveAndNavigate
          output: { requestedProjectName: string; target: string }
        },
  },
  guards: {
    [SystemIOMachineGuards.projectNameIsValidLength]: ({
      context,
      event,
    }): boolean => {
      assertEvent(event, [
        SystemIOMachineEvents.createProject,
        SystemIOMachineEvents.renameProject,
      ])
      const { requestedProjectName } = event.data
      return requestedProjectName.length <= MAX_PROJECT_NAME_LENGTH
    },
  },
  actions: {
    [SystemIOMachineActions.setFolders]: assign({
      folders: ({ event }) => {
        assertEvent(event, [
          SystemIOMachineEvents.done_readFoldersFromProjectDirectory,
          SystemIOMachineEvents.setFolders,
        ])
        return 'output' in event ? event.output : event.data.folders
      },
    }),
    [SystemIOMachineActions.setProjectDirectoryPath]: assign({
      projectDirectoryPath: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.setProjectDirectoryPath)
        return event.data.requestedProjectDirectoryPath
      },
      folders: ({ context, event }) => {
        assertEvent(event, SystemIOMachineEvents.setProjectDirectoryPath)
        return context.projectDirectoryPath ===
          event.data.requestedProjectDirectoryPath
          ? context.folders
          : undefined
      },
      hasListedProjects: ({ context, event }) => {
        assertEvent(event, SystemIOMachineEvents.setProjectDirectoryPath)
        return context.projectDirectoryPath ===
          event.data.requestedProjectDirectoryPath
          ? context.hasListedProjects
          : false
      },
    }),
    [SystemIOMachineActions.setRequestedProjectName]: assign({
      requestedProjectName: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.navigateToProject)
        return {
          name: event.data.requestedProjectName,
        }
      },
    }),
    [SystemIOMachineActions.setRequestedFileName]: assign({
      requestedFileName: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.navigateToFile)
        return {
          project: event.data.requestedProjectName,
          file: event.data.requestedFileName,
          subRoute: event.data.requestedSubRoute,
          ...(event.data.onProjectLoaderComplete
            ? { onProjectLoaderComplete: event.data.onProjectLoaderComplete }
            : {}),
        }
      },
    }),
    [SystemIOMachineActions.setDefaultProjectFolderName]: assign({
      defaultProjectFolderName: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.setDefaultProjectFolderName)
        return event.data.requestedDefaultProjectFolderName
      },
    }),
    [SystemIOMachineActions.toastSuccess]: ({ event }) => {
      // Operations may carry a stable `toastId` on their output so repeated
      // completions collapse into a single updating toast instead of stacking
      // duplicates (e.g. Zookeeper streams several bulk writes per edit).
      const toastId =
        'output' in event &&
        event.output !== null &&
        typeof event.output === 'object' &&
        'toastId' in event.output &&
        typeof event.output.toastId === 'string'
          ? event.output.toastId
          : undefined
      toast.success(
        ('data' in event && typeof event.data === 'string' && event.data) ||
          ('output' in event &&
            event.output !== undefined &&
            'message' in event.output &&
            typeof event.output.message === 'string' &&
            event.output.message) ||
          '',
        toastId ? { id: toastId } : undefined
      )
    },
    [SystemIOMachineActions.toastError]: ({ context, event }) => {
      reportSystemIOMachineError({ context, event })
      toast.error(
        ('data' in event && typeof event.data === 'string' && event.data) ||
          ('output' in event &&
            typeof event.output === 'string' &&
            event.output) ||
          ('error' in event &&
            event.error instanceof Error &&
            event.error.message) ||
          'Unknown error in SystemIOMachine.'
      )
    },
    // Zookeeper streams several bulk writes per edit; a failing edit can reject
    // each one back-to-back. Share a stable toast id so those errors collapse
    // into a single toast instead of stacking duplicates.
    [SystemIOMachineActions.toastErrorZookeeperFileWrite]: ({
      context,
      event,
    }) => {
      reportSystemIOMachineError({ context, event })
      toast.error(
        ('error' in event &&
          event.error instanceof Error &&
          event.error.message) ||
          'Unknown error in SystemIOMachine.',
        { id: ZOOKEEPER_FILE_WRITE_TOAST_ID }
      )
    },
    [SystemIOMachineActions.reportError]: reportSystemIOMachineError,
    [SystemIOMachineActions.setReadWriteProjectDirectory]: assign({
      canReadWriteProjectDirectory: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.done_checkReadWrite)
        return event.output
      },
    }),
    [SystemIOMachineActions.setRequestedTextToCadGeneration]: assign({
      requestedTextToCadGeneration: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.generateTextToCAD)
        return event.data
      },
    }),
    [SystemIOMachineActions.setLastProjectDeleteRequest]: assign({
      lastProjectDeleteRequest: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.done_deleteProject)
        return { project: event.output.name }
      },
    }),
    [SystemIOMachineActions.toastProjectNameTooLong]: () => {
      toast.error(
        `Project name is too long, must be less than or equal to ${MAX_PROJECT_NAME_LENGTH} characters.`
      )
    },
    [SystemIOMachineActions.deferSystemIOEvent]: assign({
      deferredSystemIOEvent: ({ event }) => event,
    }),
    [SystemIOMachineActions.flushDeferredSystemIOEvent]: enqueueActions(
      ({ context, enqueue }) => {
        if (!context.deferredSystemIOEvent) {
          return
        }

        const deferredEvent = context.deferredSystemIOEvent
        enqueue.assign({ deferredSystemIOEvent: undefined })
        enqueue.raise(deferredEvent as any)
      }
    ),
  },
  actors: {
    [SystemIOMachineActors.readFoldersFromProjectDirectory]: fromPromise(
      async ({ input: context }: { input: SystemIOContext }) => {
        return [] as Project[]
      }
    ),
    [SystemIOMachineActors.createProject]: fromPromise(
      async ({
        input: { context, requestedProjectName, requestedProjectTitle },
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedProjectTitle?: string
        }
      }) => {
        return { message: '', name: '' }
      }
    ),
    [SystemIOMachineActors.deleteProject]: fromPromise(
      async ({
        input: { context, requestedProjectName },
      }: {
        input: { context: SystemIOContext; requestedProjectName: string }
      }) => {
        return { message: '', name: '' }
      }
    ),
    [SystemIOMachineActors.renameProject]: fromPromise(
      async ({
        input: { context, requestedProjectName, projectName },
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          projectName: string
          redirect: boolean
        }
      }): Promise<{
        message: string
        newName: string
        oldName: string
        redirect: boolean
      }> => {
        return { message: '', newName: '', oldName: '', redirect: true }
      }
    ),
    [SystemIOMachineActors.createKCLFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedSubDirectory?: string
          requestedFileNameWithExtension: string
          requestedCode: string
          requestedSubRoute?: string
          app: App
        }
      }): Promise<{
        message: string
        fileName: string
        projectName: string
        subRoute: string
      }> => {
        return { message: '', fileName: '', projectName: '', subRoute: '' }
      }
    ),
    [SystemIOMachineActors.checkReadWrite]: fromPromise(
      async ({
        input: { context, requestedProjectDirectoryPath },
      }: {
        input: {
          context: SystemIOContext
          requestedProjectDirectoryPath: string
        }
      }): Promise<{ value: boolean; error: unknown }> => {
        return { value: true, error: undefined }
      }
    ),
    [SystemIOMachineActors.deleteKCLFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedFileName: string
        }
      }): Promise<{
        message: string
        fileName: string
        projectName: string
      }> => {
        return { message: '', fileName: '', projectName: '' }
      }
    ),
    [SystemIOMachineActors.bulkCreateKCLFiles]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          wasmInstancePromise: Promise<ModuleType>
        }
      }): Promise<{
        message: string
        fileName: string
        projectName: string
        subRoute: string
      }> => {
        return { message: '', fileName: '', projectName: '', subRoute: '' }
      }
    ),
    [SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToProject]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          requestedProjectName: string
          requestedSubRoute?: string
          wasmInstancePromise: Promise<ModuleType>
        }
      }): Promise<{
        message: string
        fileName: string
        projectName: string
        subRoute: string
      }> => {
        return { message: '', fileName: '', projectName: '', subRoute: '' }
      }
    ),
    [SystemIOMachineActors.bulkImportProjectFilesAndNavigateToFile]:
      fromPromise(
        async ({
          input,
        }: {
          input: {
            context: SystemIOContext
            files: RequestedProjectFile[]
            requestedProjectName: string
            requestedFileNameWithExtension?: string
            requestedSubRoute?: string
          }
        }): Promise<{
          message: string
          fileName: string
          projectName: string
          subRoute: string
        }> => {
          return {
            message: '',
            fileName: '',
            projectName: '',
            subRoute: '',
          }
        }
      ),
    [SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          requestedProjectName: string
          requestedFileNameWithExtension: string
          requestedSubRoute?: string
        }
      }): Promise<{
        message: string
        fileName: string
        projectName: string
        subRoute: string
      }> => {
        return { message: '', fileName: '', projectName: '', subRoute: '' }
      }
    ),
    [SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile]:
      fromPromise(
        async ({
          input,
        }: {
          input: {
            context: SystemIOContext
            files: RequestedKCLFile[]
            filesToDelete?: RequestedKCLFileDelete[]
            requestedProjectName: string
            requestedFileNameWithExtension: string
            override?: boolean
            requestedSubRoute?: string
            onFileSystemError?: () => void
            onFileSystemSuccess?: () => void
            onSuccess?: () => void
          }
        }): Promise<{
          message: string
          fileName: string
          projectName: string
          subRoute: string
          shouldNavigate: boolean
          onProjectLoaderComplete?: () => void
        }> => {
          return {
            message: '',
            fileName: '',
            projectName: '',
            subRoute: '',
            shouldNavigate: true,
          }
        }
      ),
    [SystemIOMachineActors.renameFolder]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedFolderName: string
          folderName: string
          absolutePathToParentDirectory: string
          requestedProjectName?: string
          requestedFileNameWithExtension?: string
          app: App
        }
      }) => {
        return {
          message: '',
          folderName: '',
          requestedFolderName: '',
          requestedProjectName: '',
          requestedFileNameWithExtension: '',
        }
      }
    ),
    [SystemIOMachineActors.renameFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedFileNameWithExtension: string
          fileNameWithExtension: string
          absolutePathToParentDirectory: string
          app: App
        }
      }) => {
        return {
          message: '',
          projectName: '',
          filePathWithExtensionRelativeToProject: '',
        }
      }
    ),
    [SystemIOMachineActors.deleteFileOrFolder]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedPath: string
          requestedProjectName?: string | undefined
        }
      }) => {
        return {
          message: '',
          requestedPath: '',
          requestedProjectName: '',
        }
      }
    ),
    [SystemIOMachineActors.createBlankFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedAbsolutePath: string
        }
      }) => {
        return {
          message: '',
          requestedAbsolutePath: '',
        }
      }
    ),
    [SystemIOMachineActors.createBlankFolder]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedAbsolutePath: string
        }
      }) => {
        return {
          message: '',
          requestedAbsolutePath: '',
        }
      }
    ),
    [SystemIOMachineActors.copyRecursive]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          src: string
          target: string
        }
      }) => {
        return {
          message: '',
          requestedAbsolutePath: '',
        }
      }
    ),
    [SystemIOMachineActors.moveRecursive]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          src: string
          target: string
          successMessage?: string
          requestedProjectName?: string | undefined
        }
      }) => {
        return {
          message: '',
          requestedAbsolutePath: '',
          requestedProjectName: '',
          target: input.target,
        }
      }
    ),
  },
}).createMachine({
  initial: SystemIOMachineStates.idle,
  // Remember, this machine and change its projectDirectory at any point
  // '' will be no project directory, aka clear this machine out!
  // To be the absolute root of someones computer we should take the string of path.resolve() in node.js which is different for each OS
  context: ({ input }) => ({
    ...input,
    folders: undefined,
    defaultProjectFolderName: DEFAULT_PROJECT_NAME,
    projectDirectoryPath: NO_PROJECT_DIRECTORY,
    hasListedProjects: false,
    requestedProjectName: { name: NO_PROJECT_DIRECTORY },
    requestedFileName: {
      project: NO_PROJECT_DIRECTORY,
      file: NO_PROJECT_DIRECTORY,
    },
    canReadWriteProjectDirectory: { value: true, error: undefined },
    clearURLParams: { value: false },
    requestedTextToCadGeneration: {
      requestedPrompt: '',
      requestedProjectName: NO_PROJECT_DIRECTORY,
      isProjectNew: true,
    },
    lastProjectDeleteRequest: {
      project: NO_PROJECT_DIRECTORY,
    },
    pendingRenamedProjectName: undefined,
    deferredSystemIOEvent: undefined,
    lastRecursiveMoveTarget: undefined,
    lastOperation: SystemIOMachineStates.idle,
  }),
  states: {
    [SystemIOMachineStates.idle]: {
      on: {
        // on can be an action
        [SystemIOMachineEvents.readFoldersFromProjectDirectory]: {
          target: SystemIOMachineStates.readingFolders,
        },
        [SystemIOMachineEvents.setProjectDirectoryPath]: {
          target: SystemIOMachineStates.checkingReadWrite,
          actions: [SystemIOMachineActions.setProjectDirectoryPath],
        },
        [SystemIOMachineEvents.navigateToProject]: {
          actions: [SystemIOMachineActions.setRequestedProjectName],
        },
        [SystemIOMachineEvents.navigateToFile]: {
          actions: [SystemIOMachineActions.setRequestedFileName],
        },
        [SystemIOMachineEvents.createProject]: [
          {
            guard: SystemIOMachineGuards.projectNameIsValidLength,
            target: SystemIOMachineStates.creatingProject,
          },
          {
            actions: [SystemIOMachineActions.toastProjectNameTooLong],
          },
        ],
        [SystemIOMachineEvents.renameProject]: [
          {
            target: SystemIOMachineStates.renamingProject,
            guard: SystemIOMachineGuards.projectNameIsValidLength,
          },
          {
            actions: [SystemIOMachineActions.toastProjectNameTooLong],
          },
        ],
        [SystemIOMachineEvents.deleteProject]: {
          target: SystemIOMachineStates.deletingProject,
        },
        [SystemIOMachineEvents.createKCLFile]: {
          target: SystemIOMachineStates.creatingKCLFile,
        },
        [SystemIOMachineEvents.setDefaultProjectFolderName]: {
          actions: [SystemIOMachineActions.setDefaultProjectFolderName],
        },
        [SystemIOMachineEvents.importFileFromURL]: {
          target: SystemIOMachineStates.importFileFromURL,
        },
        [SystemIOMachineEvents.generateTextToCAD]: {
          actions: [SystemIOMachineActions.setRequestedTextToCadGeneration],
        },
        [SystemIOMachineEvents.deleteKCLFile]: {
          target: SystemIOMachineStates.deletingKCLFile,
        },
        [SystemIOMachineEvents.bulkCreateKCLFiles]: {
          target: SystemIOMachineStates.bulkCreatingKCLFiles,
        },
        [SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToProject]: {
          target:
            SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToProject,
        },
        [SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile]: {
          target:
            SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile,
        },
        [SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile]: {
          target:
            SystemIOMachineStates.bulkCreateAndDeletingKCLFilesAndNavigateToFile,
        },
        [SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToFile]: {
          target: SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToFile,
        },
        [SystemIOMachineEvents.renameFolder]: {
          target: SystemIOMachineStates.renamingFolder,
        },
        [SystemIOMachineEvents.renameFile]: {
          target: SystemIOMachineStates.renamingFile,
        },
        [SystemIOMachineEvents.deleteFileOrFolder]: {
          target: SystemIOMachineStates.deletingFileOrFolder,
        },
        [SystemIOMachineEvents.createBlankFile]: {
          target: SystemIOMachineStates.creatingBlankFile,
        },
        [SystemIOMachineEvents.createBlankFolder]: {
          target: SystemIOMachineStates.creatingBlankFolder,
        },
        [SystemIOMachineEvents.renameFileAndNavigateToFile]: {
          target: SystemIOMachineStates.renamingFileAndNavigateToFile,
        },
        [SystemIOMachineEvents.renameFolderAndNavigateToFile]: {
          target: SystemIOMachineStates.renamingFolderAndNavigateToFile,
        },
        [SystemIOMachineEvents.deleteFileOrFolderAndNavigate]: {
          target: SystemIOMachineStates.deletingFileOrFolderAndNavigate,
        },
        [SystemIOMachineEvents.copyRecursive]: {
          target: SystemIOMachineStates.copyingRecursive,
        },
        [SystemIOMachineEvents.moveRecursive]: {
          target: SystemIOMachineStates.movingRecursive,
        },
        [SystemIOMachineEvents.moveRecursiveAndNavigate]: {
          target: SystemIOMachineStates.movingRecursiveAndNavigate,
        },
      },
    },
    [SystemIOMachineStates.readingFolders]: {
      on: {
        [SystemIOMachineEvents.setFolders]: {
          actions: SystemIOMachineActions.setFolders,
        },
        [SystemIOMachineEvents.readFoldersFromProjectDirectory]: {
          target: SystemIOMachineStates.readingFolders,
          reenter: true,
        },
        [SystemIOMachineEvents.setProjectDirectoryPath]: {
          target: SystemIOMachineStates.checkingReadWrite,
          actions: [SystemIOMachineActions.setProjectDirectoryPath],
        },
        [SystemIOMachineEvents.navigateToProject]: {
          actions: [SystemIOMachineActions.setRequestedProjectName],
        },
        [SystemIOMachineEvents.navigateToFile]: {
          actions: [SystemIOMachineActions.setRequestedFileName],
        },
        [SystemIOMachineEvents.createProject]: [
          {
            guard: SystemIOMachineGuards.projectNameIsValidLength,
            target: SystemIOMachineStates.creatingProject,
          },
          {
            actions: [SystemIOMachineActions.toastProjectNameTooLong],
          },
        ],
        [SystemIOMachineEvents.renameProject]: [
          {
            target: SystemIOMachineStates.renamingProject,
            guard: SystemIOMachineGuards.projectNameIsValidLength,
          },
          {
            actions: [SystemIOMachineActions.toastProjectNameTooLong],
          },
        ],
        [SystemIOMachineEvents.deleteProject]: {
          target: SystemIOMachineStates.deletingProject,
        },
        [SystemIOMachineEvents.createKCLFile]: {
          target: SystemIOMachineStates.creatingKCLFile,
        },
        [SystemIOMachineEvents.setDefaultProjectFolderName]: {
          actions: [SystemIOMachineActions.setDefaultProjectFolderName],
        },
        [SystemIOMachineEvents.importFileFromURL]: {
          target: SystemIOMachineStates.importFileFromURL,
        },
        [SystemIOMachineEvents.generateTextToCAD]: {
          actions: [SystemIOMachineActions.setRequestedTextToCadGeneration],
        },
        [SystemIOMachineEvents.deleteKCLFile]: {
          target: SystemIOMachineStates.deletingKCLFile,
        },
        [SystemIOMachineEvents.bulkCreateKCLFiles]: {
          target: SystemIOMachineStates.bulkCreatingKCLFiles,
        },
        [SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToProject]: {
          target:
            SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToProject,
        },
        [SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile]: {
          target:
            SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile,
        },
        [SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile]: {
          target:
            SystemIOMachineStates.bulkCreateAndDeletingKCLFilesAndNavigateToFile,
        },
        [SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToFile]: {
          target: SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToFile,
        },
        [SystemIOMachineEvents.renameFolder]: {
          target: SystemIOMachineStates.renamingFolder,
        },
        [SystemIOMachineEvents.renameFile]: {
          target: SystemIOMachineStates.renamingFile,
        },
        [SystemIOMachineEvents.deleteFileOrFolder]: {
          target: SystemIOMachineStates.deletingFileOrFolder,
        },
        [SystemIOMachineEvents.createBlankFile]: {
          target: SystemIOMachineStates.creatingBlankFile,
        },
        [SystemIOMachineEvents.createBlankFolder]: {
          target: SystemIOMachineStates.creatingBlankFolder,
        },
        [SystemIOMachineEvents.renameFileAndNavigateToFile]: {
          target: SystemIOMachineStates.renamingFileAndNavigateToFile,
        },
        [SystemIOMachineEvents.renameFolderAndNavigateToFile]: {
          target: SystemIOMachineStates.renamingFolderAndNavigateToFile,
        },
        [SystemIOMachineEvents.deleteFileOrFolderAndNavigate]: {
          target: SystemIOMachineStates.deletingFileOrFolderAndNavigate,
        },
        [SystemIOMachineEvents.copyRecursive]: {
          target: SystemIOMachineStates.copyingRecursive,
        },
        [SystemIOMachineEvents.moveRecursive]: {
          target: SystemIOMachineStates.movingRecursive,
        },
        [SystemIOMachineEvents.moveRecursiveAndNavigate]: {
          target: SystemIOMachineStates.movingRecursiveAndNavigate,
        },
      },
      invoke: {
        id: SystemIOMachineActors.readFoldersFromProjectDirectory,
        src: SystemIOMachineActors.readFoldersFromProjectDirectory,
        input: ({ context }) => {
          return context
        },
        onDone: {
          target: SystemIOMachineStates.idle,
          actions: [
            SystemIOMachineActions.setFolders,
            assign({
              hasListedProjects: true,
              requestedProjectName: ({ context }) => {
                // If we just finished renaming, navigate to the renamed project
                if (context.pendingRenamedProjectName) {
                  const newName = context.pendingRenamedProjectName
                  return { name: newName }
                }
                return context.requestedProjectName
              },
              pendingRenamedProjectName: () => undefined, // clear after redirect
            }),
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [
            SystemIOMachineActions.reportError,
            assign({
              folders: ({ context }) => context.folders ?? [],
              hasListedProjects: true,
            }),
          ],
        },
      },
    },
    [SystemIOMachineStates.creatingProject]: {
      invoke: {
        id: SystemIOMachineActors.createProject,
        src: SystemIOMachineActors.createProject,
        input: ({ context, event }) => {
          assertEvent(event, SystemIOMachineEvents.createProject)
          return {
            context,
            requestedProjectName: event.data.requestedProjectName,
            requestedProjectTitle: event.data.requestedProjectTitle,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              lastOperation: SystemIOMachineStates.creatingProject,
              requestedProjectName: ({ event }) => {
                return {
                  name: (event as { output: { name: string } }).output.name,
                }
              },
            }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.renamingProject]: {
      invoke: {
        id: SystemIOMachineActors.renameProject,
        src: SystemIOMachineActors.renameProject,
        input: ({ context, event }) => {
          assertEvent(event, SystemIOMachineEvents.renameProject)
          return {
            context,
            requestedProjectName: event.data.requestedProjectName,
            projectName: event.data.projectName,
            redirect: event.data.redirect,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              pendingRenamedProjectName: ({ event }) => {
                // Redirect back to the project if renamed from the current project
                const output = (
                  event as { output: { redirect: boolean; newName: string } }
                ).output
                return output.redirect ? output.newName : undefined
              },
            }),
            SystemIOMachineActions.toastSuccess,
            assign({
              lastOperation: SystemIOMachineStates.renamingProject,
              requestedProjectName: ({ event }) => {
                assertEvent(event, SystemIOMachineEvents.done_renameProject)
                return {
                  name: (event as { output: { newName: string } }).output
                    .newName,
                }
              },
            }),
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.deletingProject]: {
      invoke: {
        id: SystemIOMachineActors.deleteProject,
        src: SystemIOMachineActors.deleteProject,
        input: ({ context, event }) => {
          assertEvent(event, SystemIOMachineEvents.deleteProject)
          return {
            context,
            requestedProjectName: event.data.requestedProjectName,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              lastOperation: SystemIOMachineStates.deletingProject,
            }),
            SystemIOMachineActions.toastSuccess,
            SystemIOMachineActions.setLastProjectDeleteRequest,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.creatingKCLFile]: {
      invoke: {
        id: SystemIOMachineActors.createKCLFile,
        src: SystemIOMachineActors.createKCLFile,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.createKCLFile)
          return {
            context,
            requestedProjectName: event.data.requestedProjectName,
            requestedFileNameWithExtension:
              event.data.requestedFileNameWithExtension,
            requestedCode: event.data.requestedCode,
            app: context.app,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.importFileFromURL]: {
      invoke: {
        id: SystemIOMachineActors.importFileFromURL,
        src: SystemIOMachineActors.createKCLFile,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.importFileFromURL)
          return {
            context,
            requestedProjectName: event.data.requestedProjectName,
            requestedFileNameWithExtension:
              event.data.requestedFileNameWithExtension,
            requestedSubRoute: event.data.requestedSubRoute,
            requestedCode: event.data.requestedCode,
            app: context.app,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          // Clear on web? not desktop
          actions: [
            assign({
              lastOperation: SystemIOMachineStates.importFileFromURL,
              requestedProjectName: ({ event }) => {
                assertEvent(event, SystemIOMachineEvents.done_importFileFromURL)
                const output = (
                  event as {
                    output: {
                      projectName: string
                      fileName: string
                      subRoute?: string
                    }
                  }
                ).output
                return { name: output.projectName }
              },
              requestedFileName: ({ context, event }) => {
                assertEvent(event, SystemIOMachineEvents.done_importFileFromURL)
                const output = (
                  event as {
                    output: {
                      projectName: string
                      fileName: string
                      subRoute?: string
                    }
                  }
                ).output
                // Gotcha: file could have an ending of .kcl...
                const file = output.fileName.endsWith('.kcl')
                  ? output.fileName
                  : output.fileName + '.kcl'
                return {
                  project: output.projectName,
                  file,
                  subRoute: output.subRoute,
                }
              },
            }),
            assign({ clearURLParams: { value: true } }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.checkingReadWrite]: {
      on: {
        [SystemIOMachineEvents.readFoldersFromProjectDirectory]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.navigateToProject]: {
          actions: [SystemIOMachineActions.setRequestedProjectName],
        },
        [SystemIOMachineEvents.navigateToFile]: {
          actions: [SystemIOMachineActions.setRequestedFileName],
        },
        [SystemIOMachineEvents.setProjectDirectoryPath]: {
          target: SystemIOMachineStates.checkingReadWrite,
          reenter: true,
          actions: [SystemIOMachineActions.setProjectDirectoryPath],
        },
        [SystemIOMachineEvents.createProject]: [
          {
            guard: SystemIOMachineGuards.projectNameIsValidLength,
            actions: [SystemIOMachineActions.deferSystemIOEvent],
          },
          {
            actions: [SystemIOMachineActions.toastProjectNameTooLong],
          },
        ],
        [SystemIOMachineEvents.renameProject]: [
          {
            guard: SystemIOMachineGuards.projectNameIsValidLength,
            actions: [SystemIOMachineActions.deferSystemIOEvent],
          },
          {
            actions: [SystemIOMachineActions.toastProjectNameTooLong],
          },
        ],
        [SystemIOMachineEvents.deleteProject]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.createKCLFile]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.setDefaultProjectFolderName]: {
          actions: [SystemIOMachineActions.setDefaultProjectFolderName],
        },
        [SystemIOMachineEvents.importFileFromURL]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.generateTextToCAD]: {
          actions: [SystemIOMachineActions.setRequestedTextToCadGeneration],
        },
        [SystemIOMachineEvents.deleteKCLFile]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.bulkCreateKCLFiles]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToProject]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToFile]: {
          actions: [SystemIOMachineActions.deferSystemIOEvent],
        },
        [SystemIOMachineEvents.renameFolder]: {
          target: SystemIOMachineStates.renamingFolder,
        },
        [SystemIOMachineEvents.renameFile]: {
          target: SystemIOMachineStates.renamingFile,
        },
        [SystemIOMachineEvents.deleteFileOrFolder]: {
          target: SystemIOMachineStates.deletingFileOrFolder,
        },
        [SystemIOMachineEvents.createBlankFile]: {
          target: SystemIOMachineStates.creatingBlankFile,
        },
        [SystemIOMachineEvents.createBlankFolder]: {
          target: SystemIOMachineStates.creatingBlankFolder,
        },
        [SystemIOMachineEvents.renameFileAndNavigateToFile]: {
          target: SystemIOMachineStates.renamingFileAndNavigateToFile,
        },
        [SystemIOMachineEvents.renameFolderAndNavigateToFile]: {
          target: SystemIOMachineStates.renamingFolderAndNavigateToFile,
        },
        [SystemIOMachineEvents.deleteFileOrFolderAndNavigate]: {
          target: SystemIOMachineStates.deletingFileOrFolderAndNavigate,
        },
        [SystemIOMachineEvents.copyRecursive]: {
          target: SystemIOMachineStates.copyingRecursive,
        },
        [SystemIOMachineEvents.moveRecursive]: {
          target: SystemIOMachineStates.movingRecursive,
        },
        [SystemIOMachineEvents.moveRecursiveAndNavigate]: {
          target: SystemIOMachineStates.movingRecursiveAndNavigate,
        },
      },
      invoke: {
        id: SystemIOMachineActors.checkReadWrite,
        src: SystemIOMachineActors.checkReadWrite,
        input: ({ context, event }) => {
          assertEvent(event, SystemIOMachineEvents.setProjectDirectoryPath)
          return {
            context,
            requestedProjectDirectoryPath:
              event.data.requestedProjectDirectoryPath,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.flushDeferredSystemIOEvent],
        },
        onError: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.deletingKCLFile]: {
      invoke: {
        id: SystemIOMachineActors.deleteKCLFile,
        src: SystemIOMachineActors.deleteKCLFile,
        input: ({ context, event }) => {
          assertEvent(event, SystemIOMachineEvents.deleteKCLFile)
          return {
            context,
            requestedProjectName: event.data.requestedProjectName,
            requestedFileName: event.data.requestedFileName,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
        },
        onError: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.bulkCreatingKCLFiles]: {
      invoke: {
        id: SystemIOMachineActors.bulkCreateKCLFiles,
        src: SystemIOMachineActors.bulkCreateKCLFiles,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.bulkCreateKCLFiles)
          return {
            context,
            files: event.data.files,
            wasmInstancePromise: context.wasmInstancePromise,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToProject]: {
      invoke: {
        id: SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToProject,
        src: SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToProject,
        input: ({ context, event, self }) => {
          assertEvent(
            event,
            SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToProject
          )
          return {
            context,
            files: event.data.files,
            requestedProjectName: event.data.requestedProjectName,
            override: event.data.override,
            requestedSubRoute: event.data.requestedSubRoute,
            wasmInstancePromise: context.wasmInstancePromise,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              lastOperation:
                SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToProject,
              requestedProjectName: ({ event }) => {
                return {
                  name: event.output.projectName,
                  subRoute: event.output.subRoute,
                }
              },
            }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToFile]: {
      invoke: {
        id: SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToFile,
        src: SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToFile,
        input: ({ context, event, self }) => {
          assertEvent(
            event,
            SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToFile
          )
          return {
            context,
            files: event.data.files,
            requestedProjectName: event.data.requestedProjectName,
            override: event.data.override,
            requestedFileNameWithExtension:
              event.data.requestedFileNameWithExtension,
            requestedSubRoute: event.data.requestedSubRoute,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              requestedFileName: ({ event }) => {
                assertEvent(
                  event,
                  SystemIOMachineEvents.done_bulkCreateKCLFilesAndNavigateToFile
                )
                const output = (
                  event as {
                    output: {
                      projectName: string
                      fileName: string
                      subRoute?: string
                    }
                  }
                ).output
                // Gotcha: file could have an ending of .kcl...
                const file = output.fileName.endsWith('.kcl')
                  ? output.fileName
                  : output.fileName + '.kcl'
                return {
                  project: output.projectName,
                  file,
                  subRoute: output.subRoute,
                }
              },
            }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile]: {
      invoke: {
        id: SystemIOMachineActors.bulkImportProjectFilesAndNavigateToFile,
        src: SystemIOMachineActors.bulkImportProjectFilesAndNavigateToFile,
        input: ({ context, event }) => {
          assertEvent(
            event,
            SystemIOMachineEvents.bulkImportProjectFilesAndNavigateToFile
          )
          return {
            context,
            files: event.data.files,
            requestedProjectName: event.data.requestedProjectName,
            requestedFileNameWithExtension:
              event.data.requestedFileNameWithExtension,
            requestedSubRoute: event.data.requestedSubRoute,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              lastOperation:
                SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile,
              requestedFileName: ({ event }) => {
                const output = (
                  event as {
                    output: {
                      projectName: string
                      fileName: string
                      subRoute?: string
                    }
                  }
                ).output

                if (!output.fileName) {
                  return { project: '', file: '' }
                }

                return {
                  project: output.projectName,
                  file: output.fileName,
                  subRoute: output.subRoute,
                }
              },
              requestedProjectName: ({ event }) => {
                const output = (
                  event as {
                    output: {
                      projectName: string
                      fileName: string
                      subRoute?: string
                    }
                  }
                ).output

                if (output.fileName) {
                  return { name: NO_PROJECT_DIRECTORY }
                }

                return {
                  name: output.projectName,
                  subRoute: output.subRoute,
                }
              },
            }),
            assign({ clearURLParams: { value: true } }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.bulkCreateAndDeletingKCLFilesAndNavigateToFile]: {
      invoke: {
        id: SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
        src: SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
        input: ({ context, event, self }) => {
          assertEvent(
            event,
            SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile
          )
          return {
            context,
            files: event.data.files,
            filesToDelete: event.data.filesToDelete,
            requestedProjectName: event.data.requestedProjectName,
            override: event.data.override,
            requestedFileNameWithExtension:
              event.data.requestedFileNameWithExtension,
            requestedSubRoute: event.data.requestedSubRoute,
            onFileSystemError: event.data.onFileSystemError,
            onFileSystemSuccess: event.data.onFileSystemSuccess,
            onSuccess: event.data.onSuccess,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              requestedFileName: ({ context, event }) => {
                assertEvent(
                  event,
                  SystemIOMachineEvents.done_bulkCreateAndDeleteKCLFilesAndNavigateToFile
                )
                const output = (
                  event as {
                    output: {
                      projectName: string
                      fileName: string
                      shouldNavigate: boolean
                      onProjectLoaderComplete?: () => void
                    }
                  }
                ).output
                if (!output.shouldNavigate) {
                  return context.requestedFileName
                }
                // Gotcha: file could have an ending of .kcl...
                const file = output.fileName.endsWith('.kcl')
                  ? output.fileName
                  : output.fileName + '.kcl'
                return {
                  project: output.projectName,
                  file,
                  ...(output.onProjectLoaderComplete
                    ? {
                        onProjectLoaderComplete: output.onProjectLoaderComplete,
                      }
                    : {}),
                }
              },
            }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastErrorZookeeperFileWrite],
        },
      },
    },
    [SystemIOMachineStates.renamingFolder]: {
      invoke: {
        id: SystemIOMachineActors.renameFolder,
        src: SystemIOMachineActors.renameFolder,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.renameFolder)
          return {
            context,
            requestedFolderName: event.data.requestedFolderName,
            folderName: event.data.folderName,
            absolutePathToParentDirectory:
              event.data.absolutePathToParentDirectory,
            app: context.app,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.toastSuccess],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.renamingFile]: {
      invoke: {
        id: SystemIOMachineActors.renameFile,
        src: SystemIOMachineActors.renameFile,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.renameFile)
          return {
            context,
            requestedFileNameWithExtension:
              event.data.requestedFileNameWithExtension,
            fileNameWithExtension: event.data.fileNameWithExtension,
            absolutePathToParentDirectory:
              event.data.absolutePathToParentDirectory,
            app: context.app,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.toastSuccess],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.deletingFileOrFolder]: {
      invoke: {
        id: SystemIOMachineActors.deleteFileOrFolder,
        src: SystemIOMachineActors.deleteFileOrFolder,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.deleteFileOrFolder)
          return {
            context,
            requestedPath: event.data.requestedPath,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.toastSuccess],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.creatingBlankFile]: {
      invoke: {
        id: SystemIOMachineActors.createBlankFile,
        src: SystemIOMachineActors.createBlankFile,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.createBlankFile)
          return {
            context,
            requestedAbsolutePath: event.data.requestedAbsolutePath,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.toastSuccess],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.creatingBlankFolder]: {
      invoke: {
        id: SystemIOMachineActors.createBlankFolder,
        src: SystemIOMachineActors.createBlankFolder,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.createBlankFolder)
          return {
            context,
            requestedAbsolutePath: event.data.requestedAbsolutePath,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.toastSuccess],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.renamingFileAndNavigateToFile]: {
      invoke: {
        id: SystemIOMachineActors.renameFileAndNavigateToFile,
        src: SystemIOMachineActors.renameFile,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.renameFileAndNavigateToFile)
          return {
            context,
            requestedFileNameWithExtension:
              event.data.requestedFileNameWithExtension,
            fileNameWithExtension: event.data.fileNameWithExtension,
            absolutePathToParentDirectory:
              event.data.absolutePathToParentDirectory,
            app: context.app,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              requestedFileName: ({ event }) => {
                assertEvent(
                  event,
                  SystemIOMachineEvents.done_renameFileAndNavigateToFile
                )
                const output = (
                  event as {
                    output: {
                      projectName: string
                      filePathWithExtensionRelativeToProject: string
                    }
                  }
                ).output
                // Gotcha: file could have an ending of .kcl...
                const file =
                  output.filePathWithExtensionRelativeToProject.endsWith('.kcl')
                    ? output.filePathWithExtensionRelativeToProject
                    : output.filePathWithExtensionRelativeToProject + '.kcl'
                return { project: output.projectName, file }
              },
            }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.renamingFolderAndNavigateToFile]: {
      invoke: {
        id: SystemIOMachineActors.renameFolderAndNavigateToFile,
        src: SystemIOMachineActors.renameFolder,
        input: ({ context, event, self }) => {
          assertEvent(
            event,
            SystemIOMachineEvents.renameFolderAndNavigateToFile
          )
          return {
            context,
            requestedFolderName: event.data.requestedFolderName,
            folderName: event.data.folderName,
            absolutePathToParentDirectory:
              event.data.absolutePathToParentDirectory,
            requestedProjectName: event.data.requestedProjectName,
            requestedFileNameWithExtension:
              event.data.requestedFileNameWithExtension,
            app: context.app,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              lastOperation:
                SystemIOMachineStates.renamingFolderAndNavigateToFile,
              requestedFileName: ({ event }) => {
                assertEvent(
                  event,
                  SystemIOMachineEvents.done_renameFolderAndNavigateToFile
                )
                const output = (
                  event as {
                    output: {
                      requestedProjectName: string
                      requestedFileNameWithExtension: string
                    }
                  }
                ).output
                // Gotcha: file could have an ending of .kcl...
                const file = output.requestedFileNameWithExtension.endsWith(
                  '.kcl'
                )
                  ? output.requestedFileNameWithExtension
                  : output.requestedFileNameWithExtension + '.kcl'
                return { project: output.requestedProjectName, file }
              },
            }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.deletingFileOrFolderAndNavigate]: {
      invoke: {
        id: SystemIOMachineActors.deleteFileOrFolderAndNavigate,
        src: SystemIOMachineActors.deleteFileOrFolder,
        input: ({ context, event, self }) => {
          assertEvent(
            event,
            SystemIOMachineEvents.deleteFileOrFolderAndNavigate
          )
          return {
            context,
            requestedPath: event.data.requestedPath,
            requestedProjectName: event.data.requestedProjectName,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              lastOperation:
                SystemIOMachineStates.deletingFileOrFolderAndNavigate,
              requestedProjectName: ({ event }) => {
                assertEvent(
                  event,
                  SystemIOMachineEvents.done_deleteFileOrFolderAndNavigate
                )
                return {
                  name: (event as { output: { requestedProjectName: string } })
                    .output.requestedProjectName,
                }
              },
            }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.copyingRecursive]: {
      invoke: {
        id: SystemIOMachineActors.copyRecursive,
        src: SystemIOMachineActors.copyRecursive,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.copyRecursive)
          return {
            context,
            src: event.data.src,
            target: event.data.target,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.toastSuccess],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.movingRecursive]: {
      invoke: {
        id: SystemIOMachineActors.moveRecursive,
        src: SystemIOMachineActors.moveRecursive,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.moveRecursive)
          return {
            context,
            src: event.data.src,
            target: event.data.target,
            successMessage: event.data.successMessage,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              lastRecursiveMoveTarget: ({ event }) => {
                return (event as { output: { target?: string } }).output.target
              },
            }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.movingRecursiveAndNavigate]: {
      invoke: {
        id: SystemIOMachineActors.moveRecursiveAndNavigate,
        src: SystemIOMachineActors.moveRecursive,
        input: ({ context, event, self }) => {
          assertEvent(event, SystemIOMachineEvents.moveRecursiveAndNavigate)
          return {
            context,
            src: event.data.src,
            target: event.data.target,
            requestedProjectName: event.data.requestedProjectName,
            successMessage: event.data.successMessage,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              lastRecursiveMoveTarget: ({ event }) => {
                return (event as { output: { target?: string } }).output.target
              },
              requestedProjectName: ({ event }) => {
                assertEvent(
                  event,
                  SystemIOMachineEvents.done_moveRecursiveAndNavigate
                )
                return {
                  name: (event as { output: { requestedProjectName: string } })
                    .output.requestedProjectName,
                }
              },
            }),
            SystemIOMachineActions.toastSuccess,
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
  },
})
