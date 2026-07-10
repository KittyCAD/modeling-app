import type { MlToolResult } from '@kittycad/lib'
import type { ExecState } from '@src/lang/wasm'
import { FILE_EXT, PROJECT_ENTRYPOINT } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import {
  type GitignoreStackEntry,
  appendGitignoreForDirectory,
  createInitialGitignoreStack,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'
import { getFilePathRelativeToProject } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import { isErr } from '@src/lib/trap'
import type { FileMeta } from '@src/lib/types'
import { isNonNullable } from '@src/lib/utils'
import {
  getZookeeperEditPatchFromToolOutput,
  isZookeeperProjectEntrypointPath,
} from '@src/lib/zookeeperEditPatch'
import toast from 'react-hot-toast'

export type RequestedKCLFile = {
  requestedProjectName: string
  requestedFileName: string
  requestedCode: string
}

export type RequestedKCLFileDelete = {
  requestedFileName: string
}

export type RequestedProjectFile = {
  requestedProjectName: string
  requestedFileName: string
  requestedData: Uint8Array<ArrayBuffer>
}

export const normalizeKCLFileDeletePath = (filePath: string) =>
  filePath.replaceAll('\\', '/')

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

type MlEphantNewFileRequestProps = {
  toolOutput: MlToolResult
  projectNameCurrentlyOpened: string
  fileFocusedOnInEditor?: FileEntry
  filesToDelete?: RequestedKCLFileDelete[]
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

  const rawRelativePath = getFilePathRelativeToProject(
    fileFocusedOnInEditor?.path || fallbackFilePath || '',
    projectNameCurrentlyOpened
  )
  const requestedFileNameWithExtension = rawRelativePath.startsWith(fsZds.sep)
    ? rawRelativePath.slice(fsZds.sep.length)
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
