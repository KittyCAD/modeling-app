/**
 * SystemIO's state names, in a module with no imports.
 *
 * Split out of `utils.ts` because that file reaches the whole SystemIO world —
 * `desktopFS`, gitignore handling, the Zookeeper edit patch, the machine
 * itself — and through it the wasm wrapper. Anything that wants only a state
 * name should not have to pull that in, and in CI, where the generated wasm
 * package is absent, importing it fails outright.
 *
 * Re-exported from `utils.ts`, so every existing import keeps working. Same
 * treatment `SystemIOMachineEvents` already gets from `events.ts`.
 */
export enum SystemIOMachineStates {
  idle = 'idle',
  readingFolders = 'readingFolders',
  settingProjectDirectoryPath = 'settingProjectDirectoryPath',
  creatingProject = 'creatingProject',
  duplicatingProject = 'duplicatingProject',
  renamingProject = 'renamingProject',
  deletingProject = 'deletingProject',
  creatingKCLFile = 'creatingKCLFile',
  checkingReadWrite = 'checkingReadWrite',
  /** TODO: rename this event to be more generic, like `createKCLFileAndNavigate` */
  importFileFromURL = 'importFileFromURL',
  deletingKCLFile = 'deletingKCLFile',
  bulkCreatingKCLFiles = 'bulkCreatingKCLFiles',
  bulkCreatingKCLFilesAndNavigateToProject = 'bulkCreatingKCLFilesAndNavigateToProject',
  bulkImportingProjectFilesAndNavigateToFile = 'bulkImportingProjectFilesAndNavigateToFile',
  bulkCreateAndDeletingKCLFilesAndNavigateToFile = 'bulk create and deleting kcl files and navigate to file',
  bulkCreatingKCLFilesAndNavigateToFile = 'bulkCreatingKCLFilesAndNavigateToFile',
  renamingFolder = 'renamingFolder',
  renamingFile = 'renamingFile',
  deletingFileOrFolder = 'deletingFileOrFolder',
  creatingBlankFile = 'creatingBlankFile',
  creatingBlankFolder = 'creatingBlankFolder',
  renamingFileAndNavigateToFile = 'renamingFileAndNavigateToFile',
  renamingFolderAndNavigateToFile = 'renamingFolderAndNavigateToFile',
  deletingFileOrFolderAndNavigate = 'delete file or folder and navigate',
  copyingRecursive = 'copying recursive',
  movingRecursive = 'moving recursive',
  movingRecursiveAndNavigate = 'moving recursive and navigate',
}
