import type { TextToCadMultiFileIterationBody as ZookeeperMultiFileIterationBody } from '@kittycad/lib'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { FileMeta } from '@src/lib/types'
import type { Selections } from '@src/machines/modelingSharedTypes'
export type KittyCadLibFile = { name: string; data: Blob }
import type { FileEntry } from '@src/lib/project'

export type KclFileMetaMap = {
  [execStateFileNamesIndex: number]: Extract<FileMeta, { type: 'kcl' }>
}

export interface PromptToEditRequest {
  body: ZookeeperMultiFileIterationBody
  files: KittyCadLibFile[]
  activeFile?: string
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
