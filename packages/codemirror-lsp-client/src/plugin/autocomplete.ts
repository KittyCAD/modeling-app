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
import { EditorView, keymap, KeyBinding } from '@codemirror/view'

import {
  CompletionTriggerKind,
  CompletionItemKind,
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

const lspAutocompleteKeymapExt = Prec.highest(
  keymap.computeN([], () => [lspAutocompleteKeymap])
)

const lspAutocomplete = (plugin: LanguageServerPlugin): Extension => {
  return autocompletion({
    defaultKeymap: false,
    override: [
      async (context) => {
        const { state, pos, explicit } = context

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
          plugin.client
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

        return await plugin.requestCompletion(
          context,
          offsetToPos(state.doc, pos),
          {
            triggerKind: trigKind,
            triggerCharacter: trigChar,
          }
        )
      },
    ],
  })
}

export default function lspAutocompletionExt(
  plugin: LanguageServerPlugin
): Extension {
  return [lspAutocompleteKeymapExt, lspAutocomplete(plugin)]
}
