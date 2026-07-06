import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeCompletion,
  currentCompletions,
  hasNextSnippetField,
  moveCompletionSelection,
  nextSnippetField,
  prevSnippetField,
  selectedCompletionIndex,
  startCompletion,
} from '@codemirror/autocomplete'
import type { CompletionContext } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { Prec, Transaction } from '@codemirror/state'
import type { KeyBinding, ViewPlugin } from '@codemirror/view'
import { EditorView, keymap } from '@codemirror/view'
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
      if (clearSnippet(view)) {
        return true
      }

      return closeCompletion(view)
    },
  },
  { key: 'ArrowDown', run: moveCompletionSelectionOrExit(true) },
  { key: 'ArrowUp', run: moveCompletionSelectionOrExit(false) },
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

// When autocomplete has been active, spaces and equals signs can be inserted at
// the wrong DOM position because CodeMirror selection state and the browser
// selection can get out of sync. Route those inputs through CodeMirror state so
// they are inserted at the editor's cursor.
const lspAutocompleteBoundaryInputExt = Prec.highest(
  EditorView.domEventHandlers({
    beforeinput(event, view) {
      const shouldRoute =
        event.inputType === 'insertText' &&
        (event.data === ' ' || event.data === '=')

      if (!shouldRoute) {
        return false
      }

      const transactionSpec = view.state.replaceSelection(event.data)
      view.dispatch({
        ...transactionSpec,
        annotations: Transaction.userEvent.of('input.type'),
      })
      return true
    },
  })
)

export function moveCompletionSelectionOrExit(forward: boolean) {
  const moveSelection = moveCompletionSelection(forward)

  return (view: EditorView): boolean => {
    const selectedIndex = selectedCompletionIndex(view.state)
    const completions = currentCompletions(view.state)

    const shouldExit =
      selectedIndex !== null &&
      (forward ? selectedIndex >= completions.length - 1 : selectedIndex <= 0)

    if (!shouldExit) {
      return moveSelection(view)
    }

    closeCompletion(view)
    return false
  }
}

export default function lspAutocompleteExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  return [
    lspAutocompleteKeymapExt,
    lspAutocompleteBoundaryInputExt,
    autocompletion({
      defaultKeymap: false,
      override: [
        async (context) => {
          const { state, pos, view } = context
          const value = view?.plugin(plugin)
          if (!value) {
            return null
          }

          const nodeBefore = syntaxTree(state).resolveInner(pos, -1)
          if (
            nodeBefore.name === 'BlockComment' ||
            nodeBefore.name === 'LineComment'
          ) {
            return null
          }

          const cmpTriggers = getCompletionTriggerKind(
            context,
            value.client.getServerCapabilities().completionProvider
              ?.triggerCharacters ?? []
          )
          if (!cmpTriggers) {
            return null
          }

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
