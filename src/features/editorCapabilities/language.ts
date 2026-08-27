import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import type { EditorCapability } from '@src/contracts/buffers'
import { zooHighlightStyle } from '@src/features/editorCapabilities/theme'

/**
 * Syntax support, selected by the buffer's language.
 *
 * A structural property, so switching a buffer's language reconfigures the
 * bundle exactly once — and a language a build does not ship simply contributes
 * nothing rather than failing.
 */
export const languageCapability: EditorCapability = {
  id: 'editor.language',
  order: 10,
  extension: (context) => {
    switch (context.languageId) {
      case 'kcl':
        return [kcl(), syntaxHighlighting(zooHighlightStyle)]
      case 'markdown':
        return [markdown(), syntaxHighlighting(zooHighlightStyle)]
      default:
        return []
    }
  },
}
