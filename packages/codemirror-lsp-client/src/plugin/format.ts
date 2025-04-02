import type { Extension } from '@codemirror/state'
import { Prec } from '@codemirror/state'
import type { EditorView, KeyBinding, ViewPlugin } from '@codemirror/view'
import { keymap } from '@codemirror/view'

import type { LanguageServerPlugin } from './lsp'

export default function lspFormatExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  const formatKeymap: readonly KeyBinding[] = [
    {
      key: 'Alt-Shift-f',
      run: (view: EditorView) => {
        let value = view.plugin(plugin)
        if (!value) return false
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
