import { defineContract, defineService } from '@kittycad/registry'
import type { CodeChangesPreviewController } from '@src/lib/codeChangesPreview'

export type CodeChangesPreviewService = Omit<
  CodeChangesPreviewController,
  'dispose'
>

export const codeChangesPreviewContract = defineContract({
  codeChangesPreviewService: defineService<CodeChangesPreviewService>(
    'code-changes-preview'
  ),
})

export const { codeChangesPreviewService } = codeChangesPreviewContract
