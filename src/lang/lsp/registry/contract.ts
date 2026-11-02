import { defineContract, defineService } from '@kittycad/registry'
import type { Extension } from '@codemirror/state'

export interface LspProject {
  name: string
  path: string
}

/** Project-owned connection; editors consume extensions for individual documents. */
export interface ProjectLanguageService {
  readonly editorExtension: (documentUri: string) => Extension
  readonly onFileCreate: (path: string) => void
  readonly onFileRename: (oldPath: string, newPath: string) => void
  readonly onFileDelete: (path: string) => void
  readonly dispose: () => void
}

/** Registry-owned factory; each project controls the lifetime of its session. */
export interface LspService {
  readonly createProjectSession: (project: LspProject) => ProjectLanguageService
}

export const lspContract = defineContract({
  lspService: defineService<LspService>('lsp.service'),
})

export const { lspService } = lspContract
