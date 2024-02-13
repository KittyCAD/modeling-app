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
