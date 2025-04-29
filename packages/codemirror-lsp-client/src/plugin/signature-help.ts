import type { Extension } from '@codemirror/state'
import { Prec } from '@codemirror/state'
import type { ViewPlugin } from '@codemirror/view'
import { EditorView } from '@codemirror/view'
import { keymap } from '@codemirror/view'

import type { LanguageServerPlugin } from './lsp'

export default function lspSignatureHelpExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  return [
    Prec.highest(
      keymap.of([
        {
          key: 'Mod-Shift-Space',
          run: (view) => {
            if (!plugin) {
              return false
            }

            const value = view.plugin(plugin)
            if (!value) return false

            const pos = view.state.selection.main.head
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            value.showSignatureHelpTooltip(view, pos)
            return true
          },
        },
      ])
    ),
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    EditorView.updateListener.of(async (update) => {
      if (!(plugin && update.docChanged)) return

      const value = update.view.plugin(plugin)
      if (!value) return false

      // Early exit if signature help capability is not supported
      if (!value.client.getServerCapabilities().signatureHelpProvider) return

      const triggerChars = value.client.getServerCapabilities()
        .signatureHelpProvider?.triggerCharacters || ['(', ',']
      let triggerCharacter: string | undefined

      // Check if changes include trigger characters
      const changes = update.changes
      let shouldTrigger = false
      let triggerPos = -1

      changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
        if (shouldTrigger) return // Skip if already found a trigger

        const text = inserted.toString()
        if (!text) return

        for (const char of triggerChars) {
          if (text.includes(char)) {
            shouldTrigger = true
            triggerPos = toB
            triggerCharacter = char
            break
          }
        }
      })

        console.log('triggerPos', triggerPos)
        console.log('shouldTrigger', shouldTrigger)

      if (shouldTrigger && triggerPos >= 0) {
        await value.showSignatureHelpTooltip(
          update.view,
          triggerPos,
          triggerCharacter
        )
      }
    }),
  ]
}
