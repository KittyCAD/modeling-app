import { Extension, Prec } from '@codemirror/state'
import { EditorView, keymap, KeyBinding } from '@codemirror/view'

import { LanguageServerPlugin } from './lsp'

export default function lspFormatExt(plugin: LanguageServerPlugin): Extension {
  const formatKeymap: readonly KeyBinding[] = [
    {
      key: 'Alt-Shift-f',
      run: (view: EditorView) => {
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
