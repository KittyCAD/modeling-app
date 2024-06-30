import { Extension, Prec } from '@codemirror/state'
import { EditorView, keymap, KeyBinding } from '@codemirror/view'

import { LanguageServerPlugin } from './lsp'

export default function lspFormatExt(
  plugin: LanguageServerPlugin | null
): Extension {
  const formatKeymap: readonly KeyBinding[] = [
    {
      key: 'Alt-Shift-f',
      run: (view: EditorView) => {
        if (!plugin) return false
        plugin.requestFormatting()
        return true
      },
    },
  ]

  // Create an extension for the key mappings.
  const formatKeymapExt = Prec.highest(
    keymap.computeN([], () => [formatKeymap])
  )

  return formatKeymapExt
}
