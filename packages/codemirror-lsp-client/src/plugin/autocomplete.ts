import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeCompletion,
  currentCompletions,
  hasNextSnippetField,
  hasPrevSnippetField,
  moveCompletionSelection,
  nextSnippetField,
  prevSnippetField,
  selectedCompletionIndex,
  startCompletion,
} from '@codemirror/autocomplete'
import type { CompletionContext } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { Prec } from '@codemirror/state'
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
  { key: 'Backspace', run: clearSnippetBeforeEmptySelectionDelete },
  { key: 'Delete', run: clearSnippetBeforeEmptySelectionDelete },
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

export function clearSnippetBeforeEmptySelectionDelete(
  view: EditorView
): boolean {
  if (!view.state.selection.ranges.every((range) => range.empty)) {
    return false
  }

  if (!hasNextSnippetField(view.state) && !hasPrevSnippetField(view.state)) {
    return false
  }

  // Issue #12133: after a placeholder is emptied, Backspace/Delete can keep a
  // zero-width snippet field alive while deleting the static argument text
  // before it. That stale field then follows later input, so typing `foo =`
  // reselects `=` and leaves the cursor before it.
  clearSnippet(view)

  // Let the regular delete command still handle the keypress.
  return false
}

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
