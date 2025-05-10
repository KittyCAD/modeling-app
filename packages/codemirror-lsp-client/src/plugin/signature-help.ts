import {
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from '@codemirror/state'
import type { Tooltip } from '@codemirror/view'
import { type ViewPlugin, showTooltip } from '@codemirror/view'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { type SyntaxNode } from '@lezer/common'

import type { LanguageServerPlugin } from './lsp'

export const setSignatureTooltip = StateEffect.define<Tooltip | null>()

function findParenthesized(
  state: EditorState,
  pos: number,
  side: 1 | 0 | -1 = 0
) {
  let context: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side)
  while (context) {
    const open = context.firstChild
    if (
      open &&
      open.from == context.from &&
      open.to == context.from + 1 &&
      state.doc.sliceString(open.from, open.to) == '('
    )
      break
    context = context.parent
  }
  return context
}

const signatureTooltip = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (let effect of tr.effects) {
      if (effect.is(setSignatureTooltip)) return effect.value
    }
    if (!value) return null
    if (tr.selection) {
      let parens = findParenthesized(tr.state, tr.selection.main.head)
      if (!parens || parens.from != value.pos) return null
    }
    return tr.docChanged
      ? { ...value, pos: tr.changes.mapPos(value.pos) }
      : value
  },
  provide: (f) => [
    showTooltip.from(f),
    EditorView.domEventHandlers({
      blur: (_, view) => {
        if (view.state.field(f)) {
          view.dispatch({ effects: setSignatureTooltip.of(null) })
        }
      },
    }),
  ],
})

export function lspSignatureHelpExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  return [
    Prec.highest(
      keymap.of([
        {
          key: 'Mod-Shift-Space',
          run: (view) => {
            const value = view.plugin(plugin)
            if (!value) return false

            const parens = findParenthesized(
              view.state,
              view.state.selection.main.head
            )
            if (!parens) return false
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            value.showSignatureHelpTooltip(view, parens.from)
            return true
          },
        },
      ])
    ),
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    EditorView.updateListener.of(async (update) => {
      if (!update.docChanged) return

      // Make sure this is a valid user typing event.
      if (!update.transactions.some((tr) => tr.isUserEvent('input'))) {
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
      let triggerPos = -1

      changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
        if (triggerPos >= 0) return // Skip if already found a trigger

        const text = inserted.toString()
        if (!text) return

        for (const char of triggerChars) {
          if (text.includes(char)) {
            triggerPos = toB
            triggerCharacter = char
            break
          }
        }
      })

      if (triggerPos >= 0) {
        const parens = findParenthesized(update.view.state, triggerPos, -1)
        if (parens) {
          await value.showSignatureHelpTooltip(
            update.view,
            parens.from,
            triggerCharacter
          )
        }
      }
    }),
    signatureTooltip,
  ]
}
