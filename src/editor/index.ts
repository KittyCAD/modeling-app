import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language'
import { lintGutter, lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Extension, Prec } from '@codemirror/state'
import {
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import interact from '@replit/codemirror-interact'
import { historyCompartment } from '@src/editor/compartments'
import { lineHighlightField } from '@src/editor/highlightextension'
import { onMouseDragRegex, onMouseDragMakeANewNumber } from '@src/lib/utils'
import { kclLspCompartment } from './plugins/lsp/kcl'
import { themeCompartment } from './plugins/theme'

export const lineWrappingCompartment = new Compartment()

export function baseEditorExtensions() {
  const extensions: Extension = [
    // This extension is empty to begin with, then reconfigured when the LSP becomes available
    kclLspCompartment.of([]),
    lineWrappingCompartment.of([]),
    lineHighlightField,
    historyCompartment.of(history()),
    closeBrackets(),
    codeFolding(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    lintGutter(),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    foldGutter(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    // The theme extension is reconfigured once the setting is available
    themeCompartment.of(Prec.highest([])),
    rectangularSelection(),
    dropCursor(),
    interact({
      rules: [
        // a rule for a number dragger
        {
          // the regexp matching the value
          regexp: onMouseDragRegex,
          // set cursor to "ew-resize" on hover
          cursor: 'ew-resize',
          // change number value based on mouse X movement on drag
          onDrag: (text, setText, e) => {
            onMouseDragMakeANewNumber(text, setText, e)
          },
        },
      ],
    }),
  ]

  return extensions
}
