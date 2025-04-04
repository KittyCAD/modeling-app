import { setup } from 'xstate'
import { DEFAULT_PROJECT_NAME } from "@src/lib/constants"

const NO_PROJECT_DIRECTORY = ''

type SystemIOFolder = {
}

type SystemIOContext = {
  // Only store folders under the projectDirectory, do not maintain folders outside this directory
  folders: SystemIOFolder[],
  // For this machines runtime, this is the default string when creating a project
  // A project is defined by creating a folder at the one level below the working project directory
  defaultProjectFolderName:string,
  // working project directory that stores all the project folders
  projectDirectory: string,
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
export const systemIO = setup({
  types: {
    context: {} as SystemIOContext
  }
}).createMachine({
  // Remember, this machine and change its projectDirectory at any point
  // '' will be no project directory, aka clear this machine out!
  // To be the aboslute root of someones computer we should take the string of path.resolve() in node.js which is different for each OS
  context: () => ({
    folders: [],
    defaultProjectFolderName: DEFAULT_PROJECT_NAME,
    projectDirectory: NO_PROJECT_DIRECTORY,
    hasListedProjects: false
  }),
})
