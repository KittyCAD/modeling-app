import { defineContract, firstWinsValueSpec } from '@kittycad/registry'

export interface FileImportAction {
  isSupported(path: string): boolean
  startImport(projectPath: string, path: string): void
}

export const fileImportContract = defineContract({
  fileImportActionValueSpec: firstWinsValueSpec<FileImportAction | undefined>(
    'file-import-action',
    undefined
  ),
})

export const { fileImportActionValueSpec } = fileImportContract
