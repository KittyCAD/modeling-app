import type { Project } from '@src/lib/project'

export enum SystemIOMachineActors {
  readFoldersFromProjectDirectory = 'read folders from project directory',
  setProjectDirectoryPath = 'set project directory path',
  createProject = 'create project',
  renameProject = 'rename project',
  deleteProject = 'delete project',
  createKCLFile = 'create kcl file',
  checkReadWrite = 'check read write',
  importFileFromURL = 'import file from URL',
  deleteKCLFile = 'delete kcl delete',
}

export enum SystemIOMachineStates {
  idle = 'idle',
  readingFolders = 'readingFolders',
  settingProjectDirectoryPath = 'settingProjectDirectoryPath',
  creatingProject = 'creatingProject',
  renamingProject = 'renamingProject',
  deletingProject = 'deletingProject',
  creatingKCLFile = 'creatingKCLFile',
  checkingReadWrite = 'checkingReadWrite',
  importFileFromURL = 'importFileFromURL',
  deletingKCLFile = 'deletingKCLFile',
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
  renameProject = 'rename project',
  deleteProject = 'delete project',
  done_deleteProject = donePrefix + 'delete project',
  createKCLFile = 'create kcl file',
  setDefaultProjectFolderName = 'set default project folder name',
  done_checkReadWrite = donePrefix + 'check read write',
  importFileFromURL = 'import file from URL',
  done_importFileFromURL = donePrefix + 'import file from URL',
  generateTextToCAD = 'generate text to CAD',
  deleteKCLFile = 'delete kcl file',
}

export enum SystemIOMachineActions {
  setFolders = 'set folders',
  setProjectDirectoryPath = 'set project directory path',
  setRequestedProjectName = 'set requested project name',
  setRequestedFileName = 'set requested file name',
  setDefaultProjectFolderName = 'set default project folder name',
  toastSuccess = 'toastSuccess',
  toastError = 'toastError',
  setReadWriteProjectDirectory = 'set read write project directory',
  setRequestedTextToCadGeneration = 'set requested text to cad generation',
  setLastProjectDeleteRequest = 'set last project delete request',
}

export const NO_PROJECT_DIRECTORY = ''

export type SystemIOContext = {
  /** Only store folders under the projectDirectory, do not maintain folders outside this directory */
  folders: Project[]
  /** For this machines runtime, this is the default string when creating a project
   * A project is defined by creating a folder at the one level below the working project directory */
  defaultProjectFolderName: string
  /** working project directory that stores all the project folders */
  projectDirectoryPath: string
  /** has the application gone through the initialization of systemIOMachine at least once.
   * this is required to prevent chokidar from spamming invalid events during initialization. */
  hasListedProjects: boolean
  requestedProjectName: { name: string }
  requestedFileName: { project: string; file: string; subRoute?: string }
  canReadWriteProjectDirectory: { value: boolean; error: unknown }
  clearURLParams: { value: boolean }
  requestedTextToCadGeneration: {
    requestedPrompt: string
    requestedProjectName: string
    isProjectNew: boolean
  }
  lastProjectDeleteRequest: {
    project: string
  }
}
