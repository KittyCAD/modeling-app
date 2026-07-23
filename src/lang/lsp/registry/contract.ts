import { defineContract, defineService } from '@kittycad/registry'
import type { KclLspEditor } from '@src/lang/lsp/types'
import type { FileEntry } from '@src/lib/project'

export type LspService = {
  attachKclManager: (kclManager: KclLspEditor) => () => void
  onProjectClose: (
    file: FileEntry | null,
    projectPath: string | null,
    redirect: boolean
  ) => void
  onProjectOpen: (
    project: { name: string | null; path: string | null } | null,
    file: FileEntry | null
  ) => void
  onFileOpen: (filePath: string | null, projectPath: string | null) => void
  onFileClose: (filePath: string | null, projectPath: string | null) => void
  onFileCreate: (file: FileEntry, projectPath: string | null) => void
  onFileRename: (
    oldFile: FileEntry,
    newFile: FileEntry,
    projectPath: string | null
  ) => void
  onFileDelete: (file: FileEntry, projectPath: string | null) => void
}

export const lspContract = defineContract({
  lspService: defineService<LspService>('lsp.service'),
})

export const { lspService } = lspContract
