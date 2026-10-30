import { isNonNullable } from '@src/lib/utils'
import toast from 'react-hot-toast'
import type { ExecState } from '@src/lang/wasm'
import { FILE_EXT } from '@src/lib/constants'
import { FileNotFound } from '@src/lib/fileSystem/fileOperations'
import type { Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'
import { isErr } from '@src/lib/trap'
import {
  isExcludedProjectPath,
  normalizeRelativePath as normalizeUploadRelativePath,
} from '@src/lib/fs-zds/cloud/paths'

import type { ProjectArchiveFile } from '@src/lib/fs-zds/cloud/types'

import fsZds from '@src/lib/fs-zds'

import {
  appendGitignoreForDirectoryWithFs,
  createInitialGitignoreStackWithFs,
  fileOperationsGitignoreFs,
  type GitignoreStackEntry,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'

import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

async function walkProjectFiles(
  fileOperations: FileOperationsRegistryService,
  projectRoot: string,
  visit: (path: string, relativePath: string) => void | Promise<void>,
  options: {
    exclude?: (path: string) => boolean
    normalize?: (path: string) => string
    skipMissing?: boolean
  } = {}
) {
  const gitignoreFs = fileOperationsGitignoreFs(fileOperations)
  const normalize = options.normalize ?? normalizeRelativePath
  const walk = async (directory: string, stack: GitignoreStackEntry[]) => {
    for (const entry of await fileOperations.readDirectory(directory)) {
      if (options.exclude?.(entry)) continue
      const path = fsZds.join(directory, entry)
      const relativePath = normalize(fsZds.relative(projectRoot, path))
      let isDirectory: boolean
      try {
        isDirectory = (await fileOperations.stat(path)).kind === 'directory'
      } catch (error) {
        if (options.skipMissing && error instanceof FileNotFound) continue
        return Promise.reject(error)
      }
      if (isPathIgnoredByGitignore(stack, relativePath, isDirectory)) continue
      if (isDirectory) {
        await walk(
          path,
          await appendGitignoreForDirectoryWithFs(
            gitignoreFs,
            stack,
            path,
            projectRoot
          )
        )
      } else {
        await visit(path, relativePath)
      }
    }
  }
  await walk(
    projectRoot,
    await createInitialGitignoreStackWithFs(gitignoreFs, projectRoot)
  )
}

/**
 * Collects files from `projectRoot` for a cloud upload archive. The walk uses
 * coordinated reads, skips internal metadata and version-control paths,
 * respects `.gitignore` rules, and returns normalized files in stable order.
 */
export async function collectProjectFilesForUpload({
  fileOperations,
  projectRoot,
}: {
  fileOperations: FileOperationsRegistryService
  projectRoot: string
}) {
  const files: ProjectArchiveFile[] = []
  await walkProjectFiles(
    fileOperations,
    projectRoot,
    async (path, relativePath) => {
      files.push({
        relativePath,
        data: Uint8Array.from(await fileOperations.readFile(path)),
      })
    },
    { exclude: isExcludedProjectPath, normalize: normalizeUploadRelativePath }
  )
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export const normalizeKCLFileDeletePath = (filePath: string) =>
  filePath.replaceAll('\\', '/')

const normalizeRelativePath = (filePath: string) => filePath.replace(/\\/g, '/')

const normalizePathForComparison = (filePath: string) => {
  const normalized = normalizeRelativePath(fsZds.resolve(filePath))
  return fsZds.sep === '\\' ? normalized.toLowerCase() : normalized
}

export const collectProjectFiles = async (args: {
  fileOperations: FileOperationsRegistryService
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
  let basePath = ''
  if (args.projectContext) {
    // Use the entire project directory as the basePath for prompt to edit, do not use relative subdir paths
    basePath = args.projectContext?.path
    const execStateNameToIndexMap: { [fileName: string]: number } = {}
    const setExecStateFileIndex = (fileName: string, index: number) => {
      const normalizedFileName = normalizeRelativePath(fileName)
      execStateNameToIndexMap[fileName] = index
      execStateNameToIndexMap[normalizedFileName] = index
      execStateNameToIndexMap[normalizePathForComparison(fileName)] = index

      const projectRelativePath = normalizeRelativePath(
        fsZds.relative(basePath, fileName) ?? ''
      )
      if (projectRelativePath && !projectRelativePath.startsWith('..')) {
        execStateNameToIndexMap[projectRelativePath] = index
      }
    }
    Object.entries(args.fileNames).forEach(([index, val]) => {
      if (val?.type === 'Local') {
        setExecStateFileIndex(val.value, Number(index))
      }
    })
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
    const execStateFileIndexForKclFile = (
      absolutePathToFileNameWithExtension: string,
      fileNameWithExtension: string
    ) =>
      execStateNameToIndexMap[absolutePathToFileNameWithExtension] ??
      execStateNameToIndexMap[
        normalizePathForComparison(absolutePathToFileNameWithExtension)
      ] ??
      execStateNameToIndexMap[fileNameWithExtension] ??
      (isSelectedFilePath(absolutePathToFileNameWithExtension) ? 0 : undefined)
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
              : args.fileOperations.readFile(
                  absolutePathToFileNameWithExtension
                )
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
                execStateFileNamesIndex: execStateFileIndexForKclFile(
                  absolutePathToFileNameWithExtension,
                  fileNameWithExtension
                ),
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

    await walkProjectFiles(args.fileOperations, basePath, pushFilePromise, {
      skipMissing: args.skipUnreadableFiles !== false,
    })
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
