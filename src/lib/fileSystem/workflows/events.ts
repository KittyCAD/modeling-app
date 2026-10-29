const donePrefix = 'donePrefix'

export enum FileWorkflowEvents {
  readFoldersFromProjectDirectory = 'readFoldersFromProjectDirectory',
  done_readFoldersFromProjectDirectory = donePrefix +
    'read folders from project directory',
  setFolders = 'setFolders',
  setProjectDirectoryPath = 'setProjectDirectoryPath',
  navigateToProject = 'navigateToProject',
  navigateToFile = 'navigateToFile',
  createProject = 'createProject',
  duplicateProject = 'duplicateProject',
  renameProject = 'renameProject',
  done_renameProject = donePrefix + 'rename project',
  deleteProject = 'deleteProject',
  done_deleteProject = donePrefix + 'delete project',
  createKCLFile = 'createKCLFile',
  setDefaultProjectFolderName = 'setDefaultProjectFolderName',
  done_checkReadWrite = donePrefix + 'check read write',
  /** TODO: rename this event to be more generic, like `createKCLFileAndNavigate` */
  importFileFromURL = 'importFileFromURL',
  done_importFileFromURL = donePrefix + 'import file from URL',
  generateZookeeper = 'generateZookeeper',
  deleteKCLFile = 'deleteKCLFile',
  bulkCreateKCLFiles = 'bulkCreateKCLFiles',
  bulkCreateKCLFilesAndNavigateToProject = 'bulkCreateKCLFilesAndNavigateToProject',
  bulkImportProjectFilesAndNavigateToFile = 'bulkImportProjectFilesAndNavigateToFile',
  bulkCreateKCLFilesAndNavigateToFile = 'bulkCreateKCLFilesAndNavigateToFile',
  done_bulkCreateKCLFilesAndNavigateToFile = donePrefix +
    'bulk create kcl files and navigate to file',
  bulkCreateAndDeleteKCLFilesAndNavigateToFile = 'bulkCreateAndDeleteKCLFilesAndNavigateToFile',
  done_bulkCreateAndDeleteKCLFilesAndNavigateToFile = donePrefix +
    'bulk create and delete kcl files and navigate to file',
  renameFolder = 'renameFolder',
  renameFile = 'renameFile',
  deleteFileOrFolder = 'deleteFileOrFolder',
  createBlankFile = 'createBlankFile',
  createBlankFolder = 'createBlankFolder',
  renameFileAndNavigateToFile = 'renameFileAndNavigateToFile',
  done_renameFileAndNavigateToFile = donePrefix +
    'rename file and navigate to file',
  renameFolderAndNavigateToFile = 'renameFolderAndNavigateToFile',
  done_renameFolderAndNavigateToFile = donePrefix +
    'rename folder and navigate to file',
  deleteFileOrFolderAndNavigate = 'deleteFileOrFolderAndNavigate',
  done_deleteFileOrFolderAndNavigate = donePrefix +
    'delete file or folder and navigate',
  copyRecursive = 'copyRecursive',
  moveRecursive = 'moveRecursive',
  moveRecursiveAndNavigate = 'moveRecursiveAndNavigate',
  done_moveRecursiveAndNavigate = donePrefix + 'move recursive and navigate',
}
