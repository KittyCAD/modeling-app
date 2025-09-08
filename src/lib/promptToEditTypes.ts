import type { SourceRangePrompt } from '@kittycad/lib'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import type { FileMeta } from '@src/lib/types'
export type KittyCadLibFile = { name: string; data: Blob }
import type { FileEntry } from '@src/lib/project'

export type KclFileMetaMap = {
  [execStateFileNamesIndex: number]: Extract<FileMeta, { type: 'kcl' }>
}

export interface PromptToEditRequest {
  body: {
    prompt: string
    source_ranges: SourceRangePrompt[]
    project_name?: string
    kcl_version: string
  }
  files: KittyCadLibFile[]
}

export interface ConstructRequestArgs {
  conversationId?: string
  prompt: string
  applicationProjectDirectory: string
  selections: Selections | null
  projectFiles: FileMeta[]
  projectName: string
  currentFile: { entry?: FileEntry; content: string }
  artifactGraph: ArtifactGraph
  kclVersion: string
}
