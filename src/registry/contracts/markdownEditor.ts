import type { MarkdownEditorActions } from '@kittycad/ui-components'
import { contract, service } from 'plankton'
export const MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE = 'markdown-editor-focused'

export type MarkdownEditorService = {
  registerActiveEditor: (actions: MarkdownEditorActions) => () => void
}
export const markdownEditorContract = contract({
  markdownEditorService: service<MarkdownEditorService>(
    'markdown-editor.service'
  ),
})

export const { markdownEditorService } = markdownEditorContract
