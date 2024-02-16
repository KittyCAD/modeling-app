import { type Metadata } from 'tauri-plugin-fs-extra-api'
import { type FileEntry } from '@tauri-apps/api/fs'

export type IndexLoaderData = {
  code: string | null
  project?: ProjectWithEntryPointMetadata
  file?: FileEntry
}

export type ProjectWithEntryPointMetadata = FileEntry & {
  entrypointMetadata: Metadata
}
export type HomeLoaderData = {
  projects: ProjectWithEntryPointMetadata[]
  newDefaultDirectory?: string
}
