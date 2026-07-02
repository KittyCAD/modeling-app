import type { ExecState } from '@src/lang/wasm'
import type { App } from '@src/lib/app'
import { FILE_EXT, PROJECT_ENTRYPOINT, REGEXP_UUIDV4 } from '@src/lib/constants'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import {
  type GitignoreStackEntry,
  appendGitignoreForDirectory,
  createInitialGitignoreStack,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'
import { getFilePathRelativeToProject, joinOSPaths } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { isErr } from '@src/lib/trap'
import type { FileMeta } from '@src/lib/types'
import { isNonNullable } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  getZookeeperEditPatchFromToolOutput,
  isZookeeperProjectEntrypointPath,
} from '@src/lib/zookeeperEditPatch'
import type { MlEphantNewFileRequestProps } from '@src/machines/systemIO/hooks'
import { getAllSubDirectoriesAtProjectRoot } from '@src/machines/systemIO/snapshotContext'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import toast from 'react-hot-toast'
import type { ActorRefFrom, EventObject } from 'xstate'

export { SystemIOMachineEvents } from '@src/machines/systemIO/events'

export type SystemIOActor = ActorRefFrom<typeof systemIOMachine>

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
  bulkImportProjectFilesAndNavigateToFile = 'bulk import project files and navigate to file',
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
  moveRecursiveAndNavigate = 'move recursive and navigate',
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
  gettingMlEphantConversations = 'getting ml-ephant conversations',
  savingMlEphantConversations = 'saving ml-ephant conversations',
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
  deferSystemIOEvent = 'defer system IO event',
  flushDeferredSystemIOEvent = 'flush deferred system IO event',
}

export enum SystemIOMachineGuards {
  projectNameIsValidLength = 'project name is valid length',
}

export const NO_PROJECT_DIRECTORY = ''

export type SystemIOInput = {
  wasmInstancePromise: Promise<ModuleType>
  app: App
}

export type SystemIOContext = SystemIOInput & {
  /** Only store folders under the projectDirectory, do not maintain folders outside this directory */
  folders?: Project[]
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
  requestedProjectName: { name: string; path?: string; subRoute?: string }
  requestedFileName: {
    project: string
    file: string
    subRoute?: string
    onProjectLoaderComplete?: () => void
  }
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

  /** Temporary storage to return to project after renaming */
  pendingRenamedProjectName?: string
  pendingRenamedProjectPath?: string
  /** Event captured while checking project-directory access. */
  deferredSystemIOEvent?: EventObject
  lastRecursiveMoveTarget?: string
  lastOperation: any

  // A mapping between project id and conversation ids.
  mlEphantConversations?: Map<string, string>
}

export type RequestedKCLFile = {
  requestedProjectName: string
  requestedFileName: string
  requestedCode: string
}

export type RequestedKCLFileDelete = {
  requestedFileName: string
}

export const normalizeKCLFileDeletePath = (filePath: string) =>
  filePath.replaceAll('\\', '/')

export type RequestedProjectFile = {
  requestedProjectName: string
  requestedFileName: string
  requestedData: Uint8Array<ArrayBuffer>
}

export const waitForIdleState = async ({
  systemIOActor,
}: {
  systemIOActor: SystemIOActor
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

  return finalPath
}

const normalizeRelativePath = (filePath: string) => filePath.replace(/\\/g, '/')

const normalizePathForComparison = (filePath: string) => {
  const normalized = normalizeRelativePath(fsZds.resolve(filePath))
  return fsZds.sep === '\\' ? normalized.toLowerCase() : normalized
}

export const collectProjectFiles = async (args: {
  selectedFileContents: string
  fileNames: ExecState['filenames']
  projectContext?: Project
  selectedFilePath?: string
  warnIfProjectExceeds64Mb?: boolean
  skipUnreadableFiles?: boolean
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
  if (args.projectContext) {
    // Use the entire project directory as the basePath for prompt to edit, do not use relative subdir paths
    basePath = args.projectContext?.path
    const selectedAbsolutePath = args.selectedFilePath
      ? normalizePathForComparison(args.selectedFilePath)
      : undefined
    const selectedRelativePath = args.selectedFilePath
      ? normalizeRelativePath(
          fsZds.relative(basePath, args.selectedFilePath) ?? ''
        )
      : undefined
    const isSelectedFilePath = (absolutePath: string) => {
      if (!args.selectedFilePath) return false

      return (
        normalizePathForComparison(absolutePath) === selectedAbsolutePath ||
        normalizeRelativePath(fsZds.relative(basePath, absolutePath) ?? '') ===
          selectedRelativePath
      )
    }
    const filePromises: Promise<FileMeta | null>[] = []
    let uploadSize = 0
    const pushFilePromise = (absolutePathToFileNameWithExtension: string) => {
      // Normalize to forward slashes: this becomes the FileMeta.relPath that is
      // sent to the ML/Zookeeper service as the `current_files` keys and the
      // `source_ranges` file paths. On Windows fsZds.relative yields backslash
      // separators, which the Linux server rejects as invalid file names.
      const fileNameWithExtension = normalizeRelativePath(
        fsZds.relative(basePath, absolutePathToFileNameWithExtension) ?? ''
      )

      filePromises.push(
        Promise.resolve()
          .then(() =>
            isSelectedFilePath(absolutePathToFileNameWithExtension)
              ? new TextEncoder().encode(args.selectedFileContents)
              : fsZds.readFile(absolutePathToFileNameWithExtension)
          )
          .then((file): FileMeta => {
            uploadSize += file.byteLength
            const decoder = new TextDecoder('utf-8')
            const fileType = fsZds.extname(absolutePathToFileNameWithExtension)
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
            const blob = new Blob([new Uint8Array(file)], {
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
            if (args.skipUnreadableFiles === false) {
              return Promise.reject(isErr(e) ? e : new Error(String(e)))
            }
            return null
          })
      )
    }

    const recursivelyPushFilePromisesFromPath = async (
      path: string,
      gitignoreStack: GitignoreStackEntry[]
    ) => {
      const entries = await fsZds.readdir(path)
      for (const entry of entries) {
        const absolutePathToFileNameWithExtension = fsZds.join(path, entry)
        const relativePath = (
          fsZds.relative(basePath, absolutePathToFileNameWithExtension) ?? ''
        ).replace(/\\/g, '/')
        const stat = await fsZds.stat(absolutePathToFileNameWithExtension)
        const isDirectory = Boolean(stat.mode & fsZdsConstants.S_IFDIR)

        if (
          isPathIgnoredByGitignore(gitignoreStack, relativePath, isDirectory)
        ) {
          continue
        }

        if (isDirectory) {
          const childGitignoreStack = await appendGitignoreForDirectory(
            gitignoreStack,
            absolutePathToFileNameWithExtension,
            basePath
          )
          await recursivelyPushFilePromisesFromPath(
            absolutePathToFileNameWithExtension,
            childGitignoreStack
          )
          continue
        }

        pushFilePromise(absolutePathToFileNameWithExtension)
      }
    }

    const gitignoreStack = await createInitialGitignoreStack(basePath)
    await recursivelyPushFilePromisesFromPath(basePath, gitignoreStack)
    projectFiles = (await Promise.all(filePromises)).filter(isNonNullable)
    const MB64 = 2 ** 20 * 64
    if (args.warnIfProjectExceeds64Mb !== false && uploadSize > MB64) {
      toast.error(
        'Your project exceeds 64Mb, this will slow down Zookeeper.\nPlease remove any unnecessary files.'
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

export const prepareMlEphantNewFileRequest = ({
  fallbackFilePath,
  toolOutput,
  projectNameCurrentlyOpened,
  fileFocusedOnInEditor,
  filesToDelete = [],
}: MlEphantNewFileRequestProps & { fallbackFilePath?: string }) => {
  if (
    toolOutput.type !== 'text_to_cad' &&
    toolOutput.type !== 'edit_kcl_code'
  ) {
    return
  }
  const outputsRecord: Record<string, string> = {
    ...(toolOutput.outputs ?? {}),
  }
  const requestedFiles: RequestedKCLFile[] = Object.entries(outputsRecord).map(
    ([relativePath, fileContents]) => {
      return {
        requestedCode: fileContents,
        requestedFileName: relativePath,
        requestedProjectName: projectNameCurrentlyOpened,
      }
    }
  )

  // getFilePathRelativeToProject intentionally keeps the leading separator
  // (e.g. "/newFile.kcl"). Strip it here so the returned value is genuinely
  // project-relative, matching what the field name promises.
  const filePathForNavigation = normalizeKCLFileDeletePath(
    fileFocusedOnInEditor?.path || fallbackFilePath || ''
  )
  const rawRelativePath = getFilePathRelativeToProject(
    filePathForNavigation,
    projectNameCurrentlyOpened,
    '/'
  )
  const requestedFileNameWithExtension = rawRelativePath.startsWith('/')
    ? rawRelativePath.slice(1)
    : rawRelativePath
  const rawZookeeperEditPatch = getZookeeperEditPatchFromToolOutput(toolOutput)
  const zookeeperEditPatch = rawZookeeperEditPatch
    ? {
        ...rawZookeeperEditPatch,
        changed_files: rawZookeeperEditPatch.changed_files?.filter(
          (file) =>
            file.status !== 'deleted' ||
            !isZookeeperProjectEntrypointPath(file.path)
        ),
      }
    : undefined
  const filesToDeleteByPath = new Map<string, RequestedKCLFileDelete>()

  for (const file of filesToDelete) {
    if (isZookeeperProjectEntrypointPath(file.requestedFileName)) continue
    filesToDeleteByPath.set(
      normalizeKCLFileDeletePath(file.requestedFileName),
      file
    )
  }

  for (const file of zookeeperEditPatch?.changed_files ?? []) {
    if (file.status !== 'deleted') continue
    filesToDeleteByPath.set(normalizeKCLFileDeletePath(file.path), {
      requestedFileName: file.path,
    })
  }

  const normalizedRequestedFileName = normalizeKCLFileDeletePath(
    requestedFileNameWithExtension
  )
  const requestedFileWasDeleted =
    normalizedRequestedFileName.length > 0 &&
    filesToDeleteByPath.has(normalizedRequestedFileName)

  return {
    files: requestedFiles,
    filesToDelete: Array.from(filesToDeleteByPath.values()),
    requestedProjectName: projectNameCurrentlyOpened,
    requestedFileNameWithExtension: requestedFileWasDeleted
      ? PROJECT_ENTRYPOINT
      : requestedFileNameWithExtension,
    zookeeperEditPatch,
  }
}
