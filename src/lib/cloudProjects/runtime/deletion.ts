import * as api from '@src/lib/cloudProjects/runtime/api'
import { parseProjectArchive } from '@src/lib/cloudProjects/runtime/archive'
import {
  CLOUD_DIRECTORIES_FILE,
  decodeCloudDirectories,
} from '@src/lib/cloudProjects/runtime/directories'
import type {
  CloudApiConfig,
  RemoteProject,
} from '@src/lib/cloudProjects/runtime/types'

/** History retains an authoritative revision reference, never a content copy. */
export interface CloudFileDeletion {
  readonly projectId: string
  readonly revision: string
  readonly relativePath: string
  readonly directory: boolean
  readonly accountId: string | undefined
}

export const isDeletedCloudPath = (deletion: CloudFileDeletion, path: string) =>
  path === deletion.relativePath ||
  (deletion.directory && path.startsWith(`${deletion.relativePath}/`))

export async function downloadDeletedCloudEntries(
  config: CloudApiConfig,
  project: RemoteProject,
  deletion: CloudFileDeletion
) {
  const version = await api.getRemoteProjectVersion(
    config,
    project,
    deletion.revision
  )
  const selected = version.files?.filter(
    (file) =>
      isDeletedCloudPath(deletion, file.relative_path) ||
      (deletion.directory && file.relative_path === CLOUD_DIRECTORIES_FILE)
  )
  const archive =
    selected?.length === 0
      ? []
      : await parseProjectArchive(
          await api.downloadRemoteProjectArchive(
            config,
            deletion.projectId,
            deletion.revision,
            selected?.map((file) => file.id)
          )
        )
  const files = archive.filter((file) =>
    isDeletedCloudPath(deletion, file.relativePath)
  )
  if (
    !deletion.directory &&
    !files.some((file) => file.relativePath === deletion.relativePath)
  )
    return Promise.reject(
      new Error('The deleted file is missing from its cloud revision.')
    )
  const directoryFile = archive.find(
    (file) => file.relativePath === CLOUD_DIRECTORIES_FILE
  )
  const directories = directoryFile
    ? decodeCloudDirectories(directoryFile.data).filter((path) =>
        isDeletedCloudPath(deletion, path)
      )
    : []
  return { files, directories }
}
