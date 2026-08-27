import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import type { EditorCapability } from '@src/contracts/buffers'

/**
 * Editing behaviour every buffer gets.
 *
 * `history()` is here rather than in the buffer because it is a capability like
 * any other — but it is the one that makes "the document outlives the view"
 * observable: undo state lives in the buffer's `EditorState`, so closing a pane
 * and reopening it leaves the undo stack intact.
 */
export const baselineCapability: EditorCapability = {
  id: 'editor.baseline',
  order: 0,
  extension: () => [
    history(),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    drawSelection(),
    rectangularSelection(),
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
  ],
}

/**
 * Read-only enforcement.
 *
 * A separate capability so the policy is visible in the capability list rather
 * than buried in a conditional inside another one, and so it can be replaced by
 * an app with a different notion of read-only.
 */
export const readOnlyCapability: EditorCapability = {
  id: 'editor.readOnly',
  order: -10,
  appliesTo: (context) => context.readOnly,
  extension: () => [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
  ],
}
