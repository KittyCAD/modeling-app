import { type FileHandle, type FileInfo } from '@tauri-apps/plugin-fs'

export type IndexLoaderData = {
  code: string | null
  project?: ProjectWithEntryPointMetadata
  file?: FileHandle
}

export type ProjectWithEntryPointMetadata = FileHandle & {
  entrypointMetadata: FileInfo
}
export type HomeLoaderData = {
  projects: ProjectWithEntryPointMetadata[]
  newDefaultDirectory?: string
}

// From https://github.com/tauri-apps/tauri/blob/1.x/tooling/api/src/fs.ts#L159
export interface FileEntry {
  path: string
  /**
   * Name of the directory/file
   * can be null if the path terminates with `..`
   */
  name?: string
  /** Children of this entry if it's a directory; null otherwise */
  children?: FileEntry[]
}
