import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeCompletion,
  hasNextSnippetField,
  moveCompletionSelection,
  nextSnippetField,
  prevSnippetField,
  startCompletion,
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { Extension, Prec } from '@codemirror/state'
import { EditorView, KeyBinding, ViewPlugin, keymap } from '@codemirror/view'
import {
  CompletionItemKind,
  CompletionTriggerKind,
} from 'vscode-languageserver-protocol'

import { LanguageServerPlugin } from './lsp'
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
  { key: 'Enter', run: acceptCompletion },
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
          const { state, pos, explicit, view } = context
          let value = view?.plugin(plugin)
          if (!value) return null

          let nodeBefore = syntaxTree(state).resolveInner(pos, -1)
          if (
            nodeBefore.name === 'BlockComment' ||
            nodeBefore.name === 'LineComment'
          )
            return null

          const line = state.doc.lineAt(pos)
          let trigKind: CompletionTriggerKind = CompletionTriggerKind.Invoked
          let trigChar: string | undefined
          if (
            !explicit &&
            value.client
              .getServerCapabilities()
              .completionProvider?.triggerCharacters?.includes(
                line.text[pos - line.from - 1]
              )
          ) {
            trigKind = CompletionTriggerKind.TriggerCharacter
            trigChar = line.text[pos - line.from - 1]
          }
          if (
            trigKind === CompletionTriggerKind.Invoked &&
            !context.matchBefore(/\w+$/)
          ) {
            return null
          }

          return await value.requestCompletion(
            context,
            offsetToPos(state.doc, pos),
            {
              triggerKind: trigKind,
              triggerCharacter: trigChar,
            }
          )
        },
      ],
    }),
  ]
}
