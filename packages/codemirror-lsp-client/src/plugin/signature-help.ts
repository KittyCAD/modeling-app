import type { Extension } from '@codemirror/state'
import { Prec, StateEffect, StateField } from '@codemirror/state'
import type { Tooltip, ViewPlugin } from '@codemirror/view'
import { EditorView, showTooltip } from '@codemirror/view'
import { keymap } from '@codemirror/view'

import type { LanguageServerPlugin } from './lsp'

export const setSignatureHelpTooltip = StateEffect.define<Tooltip | null>()

const signatureHelpTooltip = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, transaction) {
    if (tooltip && transaction.docChanged) {
      tooltip = {
        ...tooltip,
        pos: transaction.changes.mapPos(tooltip.pos),
        end:
          tooltip.end === undefined
            ? undefined
            : transaction.changes.mapPos(tooltip.end),
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(setSignatureHelpTooltip)) tooltip = effect.value
    }
    return tooltip
  },
  // Let CodeMirror manage tooltip placement, viewport size limits, and DOM cleanup.
  provide: (field) => showTooltip.from(field),
})

export default function lspSignatureHelpExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  return [
    signatureHelpTooltip,
    EditorView.baseTheme({
      // Keep long documentation scrollable within CodeMirror's constrained height.
      '.cm-signature-tooltip': { overflowY: 'auto' },
    }),
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

      // Make sure this is a valid user typing event.
      let isRelevant = false
      for (const tr of update.transactions) {
        if (tr.isUserEvent('input')) {
          isRelevant = true
        }
      }

      if (!isRelevant) {
        // We only want signature help on user events.
        return
      }

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
