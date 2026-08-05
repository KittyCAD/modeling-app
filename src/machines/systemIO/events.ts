const donePrefix = 'xstate.done.actor.'

export enum SystemIOMachineEvents {
  readFoldersFromProjectDirectory = 'read folders from project directory',
  done_readFoldersFromProjectDirectory = donePrefix +
    'read folders from project directory',
  setFolders = 'set folders',
  setProjectDirectoryPath = 'set project directory path',
  navigateToProject = 'navigate to project',
  navigateToFile = 'navigate to file',
  createProject = 'create project',
  duplicateProject = 'duplicate project',
  renameProject = 'rename project',
  done_renameProject = donePrefix + 'rename project',
  deleteProject = 'delete project',
  done_deleteProject = donePrefix + 'delete project',
  createKCLFile = 'create kcl file',
  setDefaultProjectFolderName = 'set default project folder name',
  done_checkReadWrite = donePrefix + 'check read write',
  /** TODO: rename this event to be more generic, like `createKCLFileAndNavigate` */
  importFileFromURL = 'import file from URL',
  done_importFileFromURL = donePrefix + 'import file from URL',
  generateTextToCAD = 'generate text to CAD',
  deleteKCLFile = 'delete kcl file',
  bulkCreateKCLFiles = 'bulk create kcl files',
  bulkCreateKCLFilesAndNavigateToProject = 'bulk create kcl files and navigate to project',
  bulkImportProjectFilesAndNavigateToFile = 'bulk import project files and navigate to file',
  bulkCreateKCLFilesAndNavigateToFile = 'bulk create kcl files and navigate to file',
  done_bulkCreateKCLFilesAndNavigateToFile = donePrefix +
    'bulk create kcl files and navigate to file',
  bulkCreateAndDeleteKCLFilesAndNavigateToFile = 'bulk create and delete kcl files and navigate to file',
  done_bulkCreateAndDeleteKCLFilesAndNavigateToFile = donePrefix +
    'bulk create and delete kcl files and navigate to file',
  renameFolder = 'rename folder',
  renameFile = 'rename file',
  deleteFileOrFolder = 'delete file or folder',
  createBlankFile = 'create blank file',
  createBlankFolder = 'create blank folder',
  renameFileAndNavigateToFile = 'rename file and navigate to file',
  done_renameFileAndNavigateToFile = donePrefix +
    'rename file and navigate to file',
  renameFolderAndNavigateToFile = 'rename folder and navigate to file',
  done_renameFolderAndNavigateToFile = donePrefix +
    'rename folder and navigate to file',
  deleteFileOrFolderAndNavigate = 'delete file or folder and navigate',
  done_deleteFileOrFolderAndNavigate = donePrefix +
    'delete file or folder and navigate',
  copyRecursive = 'copy recursive',
  moveRecursive = 'move recursive',
  moveRecursiveAndNavigate = 'move recursive and navigate',
  done_moveRecursiveAndNavigate = donePrefix + 'move recursive and navigate',
}
