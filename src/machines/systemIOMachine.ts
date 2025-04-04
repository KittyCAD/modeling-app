import { setup, fromPromise, assign, assertEvent} from 'xstate'
import { DEFAULT_PROJECT_NAME } from "@src/lib/constants"
import { mkdirOrNOOP, getProjectInfo } from "@src/lib/desktop"
import type { FileEntry, Project } from '@src/lib/project'

export enum SystemIOMachineActors {
  readFoldersFromProjectDirectory = "read folders from project directory",
  setProjectDirectoryPath = "set project directory path"
}

export enum SystemIOMachineStates {
  idle = "idle",
  readingFolders = "readingFolders",
  settingProjectDirectoryPath = "settingProjectDirectoryPath"
}

const donePrefix = 'xstate.done.actor.'

export enum SystemIOMachineEvents {
  readFoldersFromProjectDirectory = "read folders from project directory",
  done_readFoldersFromProjectDirectory = donePrefix + "read folders from project directory",
  setProjectDirectoryPath = "set project directory path",
  done_setProjectDirectoryPath = donePrefix + "set project directory path",
}

export enum SystemIOMachineActions {
  setFolders = "set folders",
  setProjectDirectoryPath = "set project directory path"
}

const NO_PROJECT_DIRECTORY = ''

type SystemIOContext = {
  // Only store folders under the projectDirectory, do not maintain folders outside this directory
  folders: Project[],
  // For this machines runtime, this is the default string when creating a project
  // A project is defined by creating a folder at the one level below the working project directory
  defaultProjectFolderName:string,
  // working project directory that stores all the project folders
  projectDirectoryPath: string,
  // has the application gone through the initialiation of systemIOMachine at least once.
  // this is required to prevent chokidar from spamming invalid events during initialization.
  hasListedProjects: boolean
}

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
      | { type: SystemIOMachineEvents.done_setProjectDirectoryPath; data: {requestedProjectDirectoryPath: string}, output: string}
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
        assertEvent(event, SystemIOMachineEvents.done_setProjectDirectoryPath)
        return event.output
      }
    })
  },
  actors: {
    [SystemIOMachineActors.readFoldersFromProjectDirectory]: fromPromise(async ({input:context}:{input:SystemIOContext}) => {
      const projects = []
      const projectDirectoryPath = context.projectDirectoryPath
      if (projectDirectoryPath === NO_PROJECT_DIRECTORY) {
        // TODO
        return []
      }
      await mkdirOrNOOP(projectDirectoryPath)
      // Gotcha: readdir will list all folders at this project directory even if you do not have readwrite access on the directory path
      const entries = await window.electron.readdir(projectDirectoryPath)
      const { value: canReadWriteProjectDirectory } = await window.electron.canReadWriteDirectory(projectDirectoryPath)

      for (let entry of entries) {
        // Skip directories that start with a dot
        if (entry.startsWith('.')) {
          continue
        }
        const projectPath = window.electron.path.join(projectDirectoryPath, entry)

        // if it's not a directory ignore.
        // Gotcha: statIsDirectory will work even if you do not have read write permissions on the project path
        const isDirectory = await window.electron.statIsDirectory(projectPath)
        if (!isDirectory) {
          continue
        }
        const project : Project = await getProjectInfo(projectPath)
        if (
          project.kcl_file_count === 0 &&
          project.readWriteAccess &&
          canReadWriteProjectDirectory
        ) {
          continue
        }
        projects.push(project)
      }
      return projects
    }),
    [SystemIOMachineActors.setProjectDirectoryPath]: fromPromise(async ({input}:{input: string}) => {
      return input
    })
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
        [SystemIOMachineEvents.readFoldersFromProjectDirectory]:SystemIOMachineStates.readingFolders,
        [SystemIOMachineEvents.setProjectDirectoryPath]:SystemIOMachineStates.settingProjectDirectoryPath
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
    [SystemIOMachineStates.settingProjectDirectoryPath]: {
      invoke: {
        id: SystemIOMachineActors.setProjectDirectoryPath,
        src: SystemIOMachineActors.setProjectDirectoryPath,
        input: ({event}) => {
          assertEvent(event, SystemIOMachineEvents.setProjectDirectoryPath)
          return event.data.requestedProjectDirectoryPath
        },
        onDone: {
          target: SystemIOMachineStates.readingFolders,
          actions: [
            SystemIOMachineActions.setProjectDirectoryPath
          ]
        },
        onError: {
          target: SystemIOMachineStates.idle,
        }
      }
    }
  }
})


// Watcher handler
// look at projectDirectory useEffect then send this event if it changes or if we need to do this?
// The handler needs to live somewhere... aka the provider?
