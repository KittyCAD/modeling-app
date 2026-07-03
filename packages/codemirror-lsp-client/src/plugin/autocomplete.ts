import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeCompletion,
  completionStatus,
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

const identifierContinuationCharacter = /^[A-Za-z0-9_]$/

// While the autocomplete tooltip is active or querying, Chrome can leave the
// native DOM selection at an imprecise line-boundary node around punctuation.
// If we let contenteditable handle boundary characters in that state, the DOM
// mutation can be read back one character before the CodeMirror selection.
// Route those inputs through editor state instead, but leave identifier
// characters alone so normal completion filtering/type-ahead behavior continues.
const lspAutocompleteBoundaryInputExt = Prec.highest(
  EditorView.domEventHandlers({
    beforeinput(event, view) {
      if (
        event.inputType !== 'insertText' ||
        typeof event.data !== 'string' ||
        event.data.length !== 1 ||
        identifierContinuationCharacter.test(event.data) ||
        completionStatus(view.state) === null
      ) {
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
