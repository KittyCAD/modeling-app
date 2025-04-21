import { DEFAULT_PROJECT_NAME } from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import type { SystemIOContext } from '@src/machines/systemIO/utils'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineActions,
  SystemIOMachineActors,
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import toast from 'react-hot-toast'
import { assertEvent, assign, fromPromise, setup } from 'xstate'

/**
 * Handles any system level I/O for folders and files
 * This machine will be initializes once within the applications runtime
 * and exist for the entire life cycle of the application and able to be access
 * at a global level.
 */
export const systemIOMachine = setup({
  types: {
    context: {} as SystemIOContext,
    events: {} as
      | {
          type: SystemIOMachineEvents.readFoldersFromProjectDirectory
        }
      | {
          type: SystemIOMachineEvents.done_readFoldersFromProjectDirectory
          output: Project[]
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
          data: { requestedProjectName: string; requestedFileName: string }
        }
      | {
          type: SystemIOMachineEvents.createProject
          data: { requestedProjectName: string }
        }
      | {
          type: SystemIOMachineEvents.renameProject
          data: { requestedProjectName: string; projectName: string }
        }
      | {
          type: SystemIOMachineEvents.deleteProject
          data: { requestedProjectName: string }
        }
      | {
          type: SystemIOMachineEvents.createKCLFile
          data: {
            requestedProjectName: string
            requestedFileName: string
            requestedCode: string
          }
        }
      | {
          type: SystemIOMachineEvents.importFileFromURL
          data: {
            requestedProjectName: string
            requestedFileName: string
            requestedCode: string
          }
        }
      | {
          type: SystemIOMachineEvents.setDefaultProjectFolderName
          data: { requestedDefaultProjectFolderName: string }
        },
  },
  actions: {
    [SystemIOMachineActions.setFolders]: assign({
      folders: ({ event }) => {
        assertEvent(
          event,
          SystemIOMachineEvents.done_readFoldersFromProjectDirectory
        )
        return event.output
      },
    }),
    [SystemIOMachineActions.setProjectDirectoryPath]: assign({
      projectDirectoryPath: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.setProjectDirectoryPath)
        return event.data.requestedProjectDirectoryPath
      },
    }),
    [SystemIOMachineActions.setRequestedProjectName]: assign({
      requestedProjectName: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.navigateToProject)
        return { name: event.data.requestedProjectName }
      },
    }),
    [SystemIOMachineActions.setRequestedFileName]: assign({
      requestedFileName: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.navigateToFile)
        return {
          project: event.data.requestedProjectName,
          file: event.data.requestedFileName,
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
      toast.success(
        ('data' in event && typeof event.data === 'string' && event.data) ||
          ('output' in event &&
            'message' in event.output &&
            typeof event.output.message === 'string' &&
            event.output.message) ||
          ''
      )
    },
    [SystemIOMachineActions.toastError]: ({ event }) => {
      toast.error(
        ('data' in event && typeof event.data === 'string' && event.data) ||
          ('output' in event &&
            typeof event.output === 'string' &&
            event.output) ||
          ('error' in event &&
            event.error instanceof Error &&
            event.error.message) ||
          ''
      )
    },
    [SystemIOMachineActions.setReadWriteProjectDirectory]: assign({
      canReadWriteProjectDirectory: ({ event }) => {
        assertEvent(event, SystemIOMachineEvents.done_checkReadWrite)
        return event.output
      },
    }),
  },
  actors: {
    [SystemIOMachineActors.readFoldersFromProjectDirectory]: fromPromise(
      async ({ input: context }: { input: SystemIOContext }) => {
        const folders: Project[] = []
        return folders
      }
    ),
    [SystemIOMachineActors.createProject]: fromPromise(
      async ({
        input: { context, requestedProjectName },
      }: {
        input: { context: SystemIOContext; requestedProjectName: string }
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
        }
      }): Promise<{ message: string; newName: string; oldName: string }> => {
        return { message: '', newName: '', oldName: '' }
      }
    ),
    [SystemIOMachineActors.createKCLFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedFileName: string
          requestedCode: string
        }
      }): Promise<{
        message: string
        fileName: string
        projectName: string
      }> => {
        return { message: '', fileName: '', projectName: '' }
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
  },
}).createMachine({
  initial: SystemIOMachineStates.idle,
  // Remember, this machine and change its projectDirectory at any point
  // '' will be no project directory, aka clear this machine out!
  // To be the absolute root of someones computer we should take the string of path.resolve() in node.js which is different for each OS
  context: () => ({
    folders: [],
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
        [SystemIOMachineEvents.createProject]: {
          target: SystemIOMachineStates.creatingProject,
        },
        [SystemIOMachineEvents.renameProject]: {
          target: SystemIOMachineStates.renamingProject,
        },
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
      },
    },
    [SystemIOMachineStates.readingFolders]: {
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
            assign({ hasListedProjects: true }),
          ],
        },
        onError: {
          target: SystemIOMachineStates.idle,
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
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
              requestedProjectName: ({ event }) => {
                return { name: event.output.name }
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
          actions: [SystemIOMachineActions.toastSuccess],
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
        input: ({ context, event }) => {
          assertEvent(event, SystemIOMachineEvents.createKCLFile)
          return {
            context,
            requestedProjectName: event.data.requestedProjectName,
            requestedFileName: event.data.requestedFileName,
            requestedCode: event.data.requestedCode,
          }
        },
        onDone: {
          target: SystemIOMachineStates.idle,
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
        input: ({ context, event }) => {
          assertEvent(event, SystemIOMachineEvents.importFileFromURL)
          return {
            context,
            requestedProjectName: event.data.requestedProjectName,
            requestedFileName: event.data.requestedFileName,
            requestedCode: event.data.requestedCode,
          }
        },
        onDone: {
          target: SystemIOMachineStates.idle,
          actions: [assign({ clearURLParams: { value: true } })],
        },
        onError: {
          target: SystemIOMachineStates.idle,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
    [SystemIOMachineStates.checkingReadWrite]: {
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
        },
        onError: {
          target: SystemIOMachineStates.readingFolders,
          actions: [SystemIOMachineActions.toastError],
        },
      },
    },
  },
})

// Watcher handler
// look at projectDirectory useEffect then send this event if it changes or if we need to do this?
// The handler needs to live somewhere... aka the provider?
