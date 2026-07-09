import { defineContract, defineService } from '@kittycad/registry'
import type { MarkdownEditorActions } from '@kittycad/ui-components'

export const MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE = 'markdown-editor-focused'

export type MarkdownEditorService = {
  registerActiveEditor: (actions: MarkdownEditorActions) => () => void
}

export const markdownEditorContract = defineContract({
  markdownEditorService: defineService<MarkdownEditorService>(
    'markdown-editor.service'
  ),
})

export const { markdownEditorService } = markdownEditorContract
