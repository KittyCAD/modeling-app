import type { ExecState } from '@src/lang/wasm'
import { FILE_EXT, REGEXP_UUIDV4 } from '@src/lib/constants'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import { isDesktop } from '@src/lib/isDesktop'
import { joinOSPaths } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'
import { isNonNullable } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { getAllSubDirectoriesAtProjectRoot } from '@src/machines/systemIO/snapshotContext'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import toast from 'react-hot-toast'
import type { ActorRefFrom } from 'xstate'

export enum SystemIOMachineActors {
  readFoldersFromProjectDirectory = 'read folders from project directory',
  setProjectDirectoryPath = 'set project directory path',
  createProject = 'create project',
  renameProject = 'rename project',
  deleteProject = 'delete project',
  createKCLFile = 'create kcl file',
  checkReadWrite = 'check read write',
  /** TODO: rename this event to be more generic, like `createKCLFileAndNavigate` */
  importFileFromURL = 'import file from URL',
  deleteKCLFile = 'delete kcl delete',
  bulkCreateKCLFiles = 'bulk create kcl files',
  bulkCreateKCLFilesAndNavigateToProject = 'bulk create kcl files and navigate to project',
  bulkCreateKCLFilesAndNavigateToFile = 'bulk create kcl files and navigate to file',
  bulkCreateAndDeleteKCLFilesAndNavigateToFile = 'bulk create and delete kcl files and navigate to file',
  renameFolder = 'renameFolder',
  renameFile = 'renameFile',
  deleteFileOrFolder = 'delete file or folder',
  createBlankFile = 'create blank file',
  createBlankFolder = 'create blank folder',
  renameFileAndNavigateToFile = 'rename file and navigate to file',
  renameFolderAndNavigateToFile = 'rename folder and navigate to file',
  deleteFileOrFolderAndNavigate = 'delete file or folder and navigate',
  copyRecursive = 'copy recursive',
  moveRecursive = 'move recursive',
  getMlEphantConversations = 'get ml-ephant conversations',
  saveMlEphantConversations = 'save ml-ephant conversations',
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
  /** TODO: rename this event to be more generic, like `createKCLFileAndNavigate` */
  importFileFromURL = 'importFileFromURL',
  deletingKCLFile = 'deletingKCLFile',
  bulkCreatingKCLFiles = 'bulkCreatingKCLFiles',
  bulkCreatingKCLFilesAndNavigateToProject = 'bulkCreatingKCLFilesAndNavigateToProject',
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
  gettingMlEphantConversations = 'getting ml-ephant conversations',
  savingMlEphantConversations = 'saving ml-ephant conversations',
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
  /** TODO: rename this event to be more generic, like `createKCLFileAndNavigate` */
  importFileFromURL = 'import file from URL',
  done_importFileFromURL = donePrefix + 'import file from URL',
  generateTextToCAD = 'generate text to CAD',
  deleteKCLFile = 'delete kcl file',
  bulkCreateKCLFiles = 'bulk create kcl files',
  bulkCreateKCLFilesAndNavigateToProject = 'bulk create kcl files and navigate to project',
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
  getMlEphantConversations = 'get ml-ephant conversations',
  done_getMlEphantConversations = donePrefix + 'get ml-ephant conversations',
  saveMlEphantConversations = 'save ml-ephant conversations',
  done_saveMlEphantConversations = donePrefix + 'save ml-ephant conversations',
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
  toastProjectNameTooLong = 'toast project name too long',
  setMlEphantConversations = 'set ml-ephant conversations',
}

export enum SystemIOMachineGuards {
  projectNameIsValidLength = 'project name is valid length',
}

export const NO_PROJECT_DIRECTORY = ''

export type SystemIOInput = {
  wasmInstancePromise: Promise<ModuleType>
}

export type SystemIOContext = SystemIOInput & {
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
  /**
   * We watch objects because we want to be able to navigate to itself
   * if we used a string the useEffect would not change
   */
  requestedProjectName: { name: string; subRoute?: string }
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

  // A mapping between project id and conversation ids.
  mlEphantConversations?: Map<string, string>
}

export type RequestedKCLFile = {
  requestedProjectName: string
  requestedFileName: string
  requestedCode: string
}

export const waitForIdleState = async ({
  systemIOActor,
}: {
  systemIOActor: ActorRefFrom<typeof systemIOMachine>
}) => {
  // Check if already idle before setting up subscription
  if (systemIOActor.getSnapshot().matches(SystemIOMachineStates.idle)) {
    return Promise.resolve()
  }

  const waitForIdlePromise = new Promise((resolve) => {
    const subscription = systemIOActor.subscribe((state) => {
      if (state.matches(SystemIOMachineStates.idle)) {
        subscription.unsubscribe()
        resolve(undefined)
      }
    })
  })
  return waitForIdlePromise
}

export const determineProjectFilePathFromPrompt = (
  context: SystemIOContext,
  args: {
    requestedPrompt: string
    existingProjectName?: string
  }
) => {
  const TRUNCATED_PROMPT_LENGTH = 24
  // Only add the prompt name if it is a preexisting project
  const promptNameAsDirectory = `${args.requestedPrompt
    .slice(0, TRUNCATED_PROMPT_LENGTH)
    .replace(/\s/gi, '-')
    .replace(/\W/gi, '-')
    .toLowerCase()}`

  let finalPath = promptNameAsDirectory

  if (isDesktop()) {
    // If it's not a new project, create a subdir in the current one.
    if (args.existingProjectName) {
      const firstLevelDirectories = getAllSubDirectoriesAtProjectRoot(context, {
        projectFolderName: args.existingProjectName,
      })
      const uniqueSubDirectoryName = getUniqueProjectName(
        promptNameAsDirectory,
        firstLevelDirectories
      )
      finalPath = joinOSPaths(args.existingProjectName, uniqueSubDirectoryName)
    }
  }

  return finalPath
}

export const collectProjectFiles = async (args: {
  selectedFileContents: string
  fileNames: ExecState['filenames']
  projectContext?: Project
}) => {
  let projectFiles: FileMeta[] = [
    {
      type: 'kcl',
      relPath: 'main.kcl',
      absPath: 'main.kcl',
      fileContents: args.selectedFileContents,
      execStateFileNamesIndex: 0,
    },
  ]
  const execStateNameToIndexMap: { [fileName: string]: number } = {}
  Object.entries(args.fileNames).forEach(([index, val]) => {
    if (val?.type === 'Local') {
      execStateNameToIndexMap[val.value] = Number(index)
    }
  })
  let basePath = ''
  if (isDesktop() && args.projectContext?.children) {
    // Use the entire project directory as the basePath for prompt to edit, do not use relative subdir paths
    basePath = args.projectContext?.path
    const filePromises: Promise<FileMeta | null>[] = []
    let uploadSize = 0
    const recursivelyPushFilePromises = (files: FileEntry[]) => {
      // mutates filePromises declared above, so this function definition should stay here
      // if pulled out, it would need to be refactored.
      for (const file of files) {
        if (file.children !== null) {
          // is directory
          recursivelyPushFilePromises(file.children)
          continue
        }

        const absolutePathToFileNameWithExtension = file.path
        const fileNameWithExtension =
          window.electron?.path.relative(
            basePath,
            absolutePathToFileNameWithExtension
          ) ?? ''

        const filePromise = window.electron
          ?.readFile(absolutePathToFileNameWithExtension)
          .then((file): FileMeta => {
            uploadSize += file.byteLength
            const decoder = new TextDecoder('utf-8')
            const fileType = window.electron?.path.extname(
              absolutePathToFileNameWithExtension
            )
            if (fileType === FILE_EXT) {
              return {
                type: 'kcl',
                absPath: absolutePathToFileNameWithExtension,
                relPath: fileNameWithExtension,
                fileContents: decoder.decode(file),
                execStateFileNamesIndex:
                  execStateNameToIndexMap[absolutePathToFileNameWithExtension],
              }
            }
            const blob = new Blob([file], {
              type: 'application/octet-stream',
            })
            return {
              type: 'other',
              relPath: fileNameWithExtension,
              data: blob,
            }
          })
          .catch((e) => {
            console.error('error reading file', e)
            return null
          })

        if (filePromise === undefined) {
          continue
        }

        filePromises.push(filePromise)
      }
    }
    recursivelyPushFilePromises(args.projectContext?.children)
    projectFiles = (await Promise.all(filePromises)).filter(isNonNullable)
    const MB20 = 2 ** 20 * 20
    if (uploadSize > MB20) {
      toast.error(
        'Your project exceeds 20Mb, this will slow down Zookeeper\nPlease remove any unnecessary files'
      )
    }
  }

  return projectFiles
}

export const jsonToMlConversations = (json: string) => {
  const mlConversations = new Map<string, string>()
  const untypedObject = JSON.parse(json)
  for (let entry of Object.entries(untypedObject)) {
    if (typeof entry[0] === 'string' && !REGEXP_UUIDV4.test(entry[0])) {
      console.warn(
        'Expected a project id string as a key (potentially bad format)'
      )
      continue
    }
    if (typeof entry[1] === 'string' && !REGEXP_UUIDV4.test(entry[1])) {
      console.warn('Expected a conversation id string (potentially bad format)')
      continue
    }

    if (typeof entry[0] === 'string' && typeof entry[1] === 'string') {
      mlConversations.set(entry[0], entry[1])
    }
  }
  return mlConversations
}

export const mlConversationsToJson = (
  convos: SystemIOContext['mlEphantConversations']
): string => {
  return JSON.stringify(Object.fromEntries(convos ?? new Map<string, string>()))
}
