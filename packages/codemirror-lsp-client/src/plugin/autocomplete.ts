import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeCompletion,
  completionStatus,
  hasNextSnippetField,
  moveCompletionSelection,
  nextSnippetField,
  prevSnippetField,
  startCompletion,
} from '@codemirror/autocomplete'
import { insertNewlineAndIndent } from '@codemirror/commands'
import type { CompletionContext } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { Prec, Transaction } from '@codemirror/state'
import type { EditorView, KeyBinding, ViewPlugin } from '@codemirror/view'
import { keymap } from '@codemirror/view'
import {
  CompletionItemKind,
  CompletionTriggerKind,
} from 'vscode-languageserver-protocol'

import type { LanguageServerPlugin } from './lsp'
import { offsetToPos } from './util'

export const CompletionItemKindMap = Object.fromEntries(
  Object.entries(CompletionItemKind).map(([key, value]) => [value, key])
) as Record<CompletionItemKind, string>

const lspAutocompleteKeymap: readonly KeyBinding[] = [
  { key: 'Ctrl-Space', run: startCompletion },
  {
    key: 'Escape',
    run: (view: EditorView): boolean => {
      if (clearSnippet(view)) return true

      return closeCompletion(view)
    },
  },
  { key: 'ArrowDown', run: moveCompletionSelection(true) },
  { key: 'ArrowUp', run: moveCompletionSelection(false) },
  { key: 'PageDown', run: moveCompletionSelection(true, 'page') },
  { key: 'PageUp', run: moveCompletionSelection(false, 'page') },
  {
    key: 'Enter',
    run: (view: EditorView): boolean => {
      if (completionStatus(view.state) === 'active') {
        return acceptCompletion(view)
      }

      if (!insertNewlineAndIndent(view)) {
        return false
      }

      // Enter dispatches `input`, but CodeMirror's autocomplete activation
      // listens for `input.type`. Dispatch a follow-up event so completion
      // sources can run at the new cursor position.
      view.dispatch({
        annotations: Transaction.userEvent.of('input.type'),
      })
      return true
    },
    shift: (view: EditorView): boolean => {
      if (!insertNewlineAndIndent(view)) {
        return false
      }

      view.dispatch({
        annotations: Transaction.userEvent.of('input.type'),
      })
      return true
    },
  },
  {
    key: 'Tab',
    run: (view: EditorView): boolean => {
      if (hasNextSnippetField(view.state)) {
        const result = nextSnippetField(view)
        return result
      }

      return acceptCompletion(view)
    },
    shift: prevSnippetField,
  },
]

const lspAutocompleteKeymapExt = Prec.highest(keymap.of(lspAutocompleteKeymap))

export default function lspAutocompleteExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  return [
    lspAutocompleteKeymapExt,
    autocompletion({
      defaultKeymap: false,
      override: [
        async (context) => {
          const { state, pos, view } = context
          let value = view?.plugin(plugin)
          if (!value) return null

          let nodeBefore = syntaxTree(state).resolveInner(pos, -1)
          if (
            nodeBefore.name === 'BlockComment' ||
            nodeBefore.name === 'LineComment'
          )
            return null

          const cmpTriggers = getCompletionTriggerKind(
            context,
            value.client.getServerCapabilities().completionProvider
              ?.triggerCharacters ?? []
          )
          if (!cmpTriggers) return null

          return await value.requestCompletion(
            context,
            offsetToPos(state.doc, pos),
            cmpTriggers
          )
        },
      ],
    }),
  ]
}

export function getCompletionTriggerKind(
  context: CompletionContext,
  triggerCharacters: string[]
): {
  triggerKind: CompletionTriggerKind
  triggerCharacter?: string
} | null {
  const { state, pos, explicit } = context
  const line = state.doc.lineAt(pos)

  // Determine trigger kind and character
  let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked
  let triggerCharacter: string | undefined

  // Check if completion was triggered by a special character
  const prevChar = line.text[pos - line.from - 1] || ''
  const isTriggerChar = triggerCharacters?.includes(prevChar)

  if (!explicit && isTriggerChar) {
    triggerKind = CompletionTriggerKind.TriggerCharacter
    triggerCharacter = prevChar
  }

  return { triggerKind, triggerCharacter }
}
