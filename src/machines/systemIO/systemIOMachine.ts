import {
  DEFAULT_PROJECT_NAME,
  MAX_PROJECT_NAME_LENGTH,
} from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import type {
  SystemIOContext,
  RequestedKCLFile,
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
import { assertEvent, assign, fromPromise, setup } from 'xstate'
import type { AppMachineContext } from '@src/lib/types'

/**
 * /some/dir            = directoryPath
 * report               = fileNameWithoutExtension
 * report.csv           = fileNameWithExtension
 * /some/dir/report.csv = absolutePathToFileNameWithExtension
 * /some/dir/report     = absolutePathTOFileNameWithoutExtension
 * /some/dir/dreport    = absolutePathToDirectory
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
          data: {
            requestedProjectName: string
            requestedFileName: string
            requestedSubRoute?: string
          }
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
          type: SystemIOMachineEvents.done_deleteProject
          output: { message: string; name: string }
        }
      | {
          type: SystemIOMachineEvents.createKCLFile
          data: {
            requestedProjectName: string
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
          type: SystemIOMachineEvents.importFileFromURL
          data: {
            requestedProjectName: string
            requestedFileNameWithExtension: string
            requestedCode: string
            requestedSubRoute?: string
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
          'Unknown error in SystemIOMachine'
      )
    },
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
        `Project name is too long, must be less than or equal to ${MAX_PROJECT_NAME_LENGTH} characters`
      )
    },
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
          requestedFileNameWithExtension: string
          requestedCode: string
          rootContext: AppMachineContext
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
          rootContext: AppMachineContext
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
          rootContext: AppMachineContext
          requestedProjectName: string
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
    [SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          rootContext: AppMachineContext
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
    requestedTextToCadGeneration: {
      requestedPrompt: '',
      requestedProjectName: NO_PROJECT_DIRECTORY,
      isProjectNew: true,
    },
    lastProjectDeleteRequest: {
      project: NO_PROJECT_DIRECTORY,
    },
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
        [SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToFile]: {
          target: SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToFile,
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
          actions: [
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
            rootContext: self.system.get('root').getSnapshot().context,
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
            rootContext: self.system.get('root').getSnapshot().context,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          // Clear on web? not desktop
          actions: [
            assign({
              requestedProjectName: ({ event }) => {
                assertEvent(event, SystemIOMachineEvents.done_importFileFromURL)
                return {
                  name: event.output.projectName,
                }
              },
              requestedFileName: ({ event }) => {
                assertEvent(event, SystemIOMachineEvents.done_importFileFromURL)
                // Gotcha: file could have an ending of .kcl...
                const file = event.output.fileName.endsWith('.kcl')
                  ? event.output.fileName
                  : event.output.fileName + '.kcl'
                return {
                  project: event.output.projectName,
                  file,
                  subRoute: event.output.subRoute,
                }
              },
            }),
            assign({ clearURLParams: { value: true } }),
          ],
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
            rootContext: self.system.get('root').getSnapshot().context,
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
            rootContext: self.system.get('root').getSnapshot().context,
            requestedProjectName: event.data.requestedProjectName,
            override: event.data.override,
            requestedSubRoute: event.data.requestedSubRoute,
          }
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            assign({
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
            rootContext: self.system.get('root').getSnapshot().context,
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
                // Gotcha: file could have an ending of .kcl...
                const file = event.output.fileName.endsWith('.kcl')
                  ? event.output.fileName
                  : event.output.fileName + '.kcl'
                return {
                  project: event.output.projectName,
                  file,
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
