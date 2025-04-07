import { setup, fromPromise, assign, assertEvent} from 'xstate'
import { DEFAULT_PROJECT_NAME } from "@src/lib/constants"
import type { Project } from '@src/lib/project'
import {SystemIOMachineEvents, SystemIOMachineActions, SystemIOMachineActors, SystemIOMachineStates, NO_PROJECT_DIRECTORY, SystemIOContext} from "@src/machines/systemIO/utils"

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
      | { type: SystemIOMachineEvents.readFoldersFromProjectDirectory; data: {} }
      | { type: SystemIOMachineEvents.done_readFoldersFromProjectDirectory; data: {}, output: Project[] }
      | { type: SystemIOMachineEvents.setProjectDirectoryPath; data: {requestedProjectDirectoryPath: string}}
  },
  actions: {
    [SystemIOMachineActions.setFolders]: assign({
      folders:({event})=>{
        assertEvent(event, SystemIOMachineEvents.done_readFoldersFromProjectDirectory)
        return event.output
      }
    }),
    [SystemIOMachineActions.setProjectDirectoryPath]: assign({
      projectDirectoryPath:({event})=>{
        assertEvent(event, SystemIOMachineEvents.setProjectDirectoryPath)
        return event.data.requestedProjectDirectoryPath
      }
    })
  },
  actors: {
    [SystemIOMachineActors.readFoldersFromProjectDirectory]: fromPromise(async ({input:context}:{input:SystemIOContext}) => {
      return []
    }),
  }
}).createMachine({
  initial:SystemIOMachineStates.idle,
  // Remember, this machine and change its projectDirectory at any point
  // '' will be no project directory, aka clear this machine out!
  // To be the aboslute root of someones computer we should take the string of path.resolve() in node.js which is different for each OS
  context: () => ({
    folders: [],
    defaultProjectFolderName: DEFAULT_PROJECT_NAME,
    projectDirectoryPath: NO_PROJECT_DIRECTORY,
    hasListedProjects: false
  }),
  states: {
    [SystemIOMachineStates.idle]: {
      on: {
        // on can be an action
        [SystemIOMachineEvents.readFoldersFromProjectDirectory]:SystemIOMachineStates.readingFolders,
        [SystemIOMachineEvents.setProjectDirectoryPath]:{
          target: SystemIOMachineStates.readingFolders,
          actions: [
            SystemIOMachineActions.setProjectDirectoryPath
          ]
        }
      }
    },
    [SystemIOMachineStates.readingFolders]: {
      invoke: {
        id: SystemIOMachineActors.readFoldersFromProjectDirectory,
        src: SystemIOMachineActors.readFoldersFromProjectDirectory,
        input: ({context}) => {
          return context
        },
        onDone: {
          target: SystemIOMachineStates.idle,
          actions: [
            SystemIOMachineActions.setFolders
          ]
        },
        onError: {
          target: SystemIOMachineStates.idle,
        }
      }
    },
  }
})


// Watcher handler
// look at projectDirectory useEffect then send this event if it changes or if we need to do this?
// The handler needs to live somewhere... aka the provider?
