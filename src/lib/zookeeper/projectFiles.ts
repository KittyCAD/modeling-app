import type { MlToolResult } from '@kittycad/lib'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import type { FileEntry } from '@src/lib/project'
import fsZds from '@src/lib/fs-zds'
import { getFilePathRelativeToProject } from '@src/lib/paths'
import { normalizeKCLFileDeletePath } from '@src/lib/fileSystem/projectFiles'
import {
  getZookeeperEditPatchFromToolOutput,
  isZookeeperProjectEntrypointPath,
  normalizeZookeeperPatchPath,
} from '@src/lib/zookeeper/zookeeperEditPatch'

export interface BulkFileWriteProgress {
  written: number
  total: number
}

export type RequestedKCLFile = {
  requestedProjectName: string
  requestedFileName: string
  requestedCode: string
}

export type RequestedKCLFileDelete = {
  requestedFileName: string
}

type ZookeeperNewFileRequestProps = {
  toolOutput: MlToolResult
  projectNameCurrentlyOpened: string
  fileFocusedOnInEditor?: FileEntry
}

export const prepareZookeeperNewFileRequest = ({
  fallbackFilePath,
  toolOutput,
  projectNameCurrentlyOpened,
  fileFocusedOnInEditor,
}: ZookeeperNewFileRequestProps & { fallbackFilePath?: string }) => {
  if (
    toolOutput.type !== 'text_to_cad' &&
    toolOutput.type !== 'edit_kcl_code'
  ) {
    return
  }
  const rawZookeeperEditPatch = getZookeeperEditPatchFromToolOutput(toolOutput)
  const writablePaths = new Set(
    (rawZookeeperEditPatch?.changed_files ?? [])
      .filter((file) => file.status === 'created' || file.status === 'modified')
      .map((file) => normalizeZookeeperPatchPath(file.path))
  )
  const requestedFiles: RequestedKCLFile[] = Object.entries(
    toolOutput.outputs ?? {}
  )
    .filter(([relativePath]) =>
      writablePaths.has(normalizeZookeeperPatchPath(relativePath))
    )
    .map(([relativePath, fileContents]) => ({
      requestedCode: fileContents,
      requestedFileName: normalizeZookeeperPatchPath(relativePath),
      requestedProjectName: projectNameCurrentlyOpened,
    }))

  // getFilePathRelativeToProject intentionally keeps the leading separator
  // (e.g. "/newFile.kcl"). Strip it here so the returned value is genuinely
  // project-relative, matching what the field name promises.
  const rawRelativePath = getFilePathRelativeToProject(
    fileFocusedOnInEditor?.path || fallbackFilePath || '',
    projectNameCurrentlyOpened
  )
  const requestedFileNameWithExtension = rawRelativePath.startsWith(fsZds.sep)
    ? rawRelativePath.slice(fsZds.sep.length)
    : rawRelativePath
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
