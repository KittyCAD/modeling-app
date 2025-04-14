import type { Project } from '@src/lib/project'

export enum SystemIOMachineActors {
  readFoldersFromProjectDirectory = 'read folders from project directory',
  setProjectDirectoryPath = 'set project directory path',
  createProject = 'create project',
  renameProject = 'rename project'
}

export enum SystemIOMachineStates {
  idle = 'idle',
  readingFolders = 'readingFolders',
  settingProjectDirectoryPath = 'settingProjectDirectoryPath',
  creatingProject = 'creatingProject',
  renamingProject = 'renamingProject'
}

const donePrefix = 'xstate.done.actor.'

export enum SystemIOMachineEvents {
  readFoldersFromProjectDirectory = 'read folders from project directory',
  done_readFoldersFromProjectDirectory = donePrefix +
    'read folders from project directory',
  setProjectDirectoryPath = 'set project directory path',
  navigateToProject = 'navigate to project',
  navigateToFile = 'navigate to file',
  createProject = 'create project',
  renameProject = 'rename project'
}

export enum SystemIOMachineActions {
  setFolders = 'set folders',
  setProjectDirectoryPath = 'set project directory path',
  setRequestedProjectName = 'set requested project name',
  setRequestedFileName = 'set requested file name',
}

export const NO_PROJECT_DIRECTORY = ''

export type SystemIOContext = {
  // Only store folders under the projectDirectory, do not maintain folders outside this directory
  folders: Project[]
  // For this machines runtime, this is the default string when creating a project
  // A project is defined by creating a folder at the one level below the working project directory
  defaultProjectFolderName: string
  // working project directory that stores all the project folders
  projectDirectoryPath: string
  // has the application gone through the initialiation of systemIOMachine at least once.
  // this is required to prevent chokidar from spamming invalid events during initialization.
  hasListedProjects: boolean
  requestedProjectName: { name: string }
  requestedFileName: { project: string; file: string }
}
