import type { Models } from '@kittycad/lib'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import type { FileMeta } from '@src/lib/types'
import type { File as KittyCadLibFile } from '@kittycad/lib/dist/types/src/models'
import type { FileEntry } from '@src/lib/project'

export type KclFileMetaMap = {
  [execStateFileNamesIndex: number]: Extract<FileMeta, { type: 'kcl' }>
}

export type TextToCadErrorResponse = {
  error_code: string
  message: string
}

export interface PromptToEditRequest {
  body: {
    prompt: string
    source_ranges: Models['SourceRangePrompt_type'][]
    project_name?: string
    kcl_version: string
  }
  files: KittyCadLibFile[]
}

export interface ConstructRequestArgs {
  conversationId?: string
  prompt: string
  selections: Selections | null
  projectFiles: FileMeta[]
  projectName: string
  currentFile: { entry?: FileEntry; content: string }
  artifactGraph: ArtifactGraph
  kclVersion: string
}
