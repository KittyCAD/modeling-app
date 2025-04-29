import type { Extension } from '@codemirror/state'
import { Prec } from '@codemirror/state'
import type { ViewPlugin } from '@codemirror/view'
import { keymap } from '@codemirror/view'

import type { LanguageServerPlugin } from './lsp'
import { offsetToPos } from './util'

export default function lspAutocompleteExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  return [
    Prec.highest(
      keymap.of([
        {
          key: 'F2',
          run: (view) => {
            if (!plugin) return false

            const value = view.plugin(plugin)
            if (!value) return false

            const pos = view.state.selection.main.head
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            value.requestRename(view, offsetToPos(view.state.doc, pos))
            return true
          },
        },
      ])
    ),
  ]
}
