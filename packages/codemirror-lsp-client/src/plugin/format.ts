import { Extension, Prec } from '@codemirror/state'
import { EditorView, keymap, KeyBinding, ViewPlugin } from '@codemirror/view'

import { LanguageServerPlugin } from './lsp'

export default function lspFormatExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  const formatKeymap: readonly KeyBinding[] = [
    {
      key: 'Alt-Shift-f',
      run: (view: EditorView) => {
        let value = view.plugin(plugin)
        if (!value) return false
        value.requestFormatting()
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
