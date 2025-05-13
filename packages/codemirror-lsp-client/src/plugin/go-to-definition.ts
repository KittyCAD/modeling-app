import type { Extension } from '@codemirror/state'
import { Prec } from '@codemirror/state'
import type { ViewPlugin } from '@codemirror/view'
import { keymap } from '@codemirror/view'

import type { LanguageServerPlugin } from './lsp'
import { offsetToPos, showErrorMessage } from './util'

export default function lspGoToDefinitionExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  return [
    Prec.highest(
      keymap.of([
        {
          key: 'F12',
          run: (view) => {
            const value = view.plugin(plugin)
            if (!value) return false

            const pos = view.state.selection.main.head
            value
              .requestDefinition(view, offsetToPos(view.state.doc, pos))
              .catch((error) =>
                showErrorMessage(
                  view,
                  `Go to definition failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
              )
            return true
          },
        },
      ])
    ),
  ]
}
