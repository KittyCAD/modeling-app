import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
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
import {
  Compartment,
  EditorState,
  type Extension,
  Prec,
} from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import interact from '@replit/codemirror-interact'
import { localHistoryTarget } from '@src/editor/HistoryView'
import { historyCompartment } from '@src/editor/compartments'
import { lineHighlightField } from '@src/editor/highlightextension'
import { createHistoryExtension } from '@src/editor/historyConfig'
import { kclAstExtension } from '@src/editor/plugins/ast'
import { blurOnEscape } from '@src/editor/plugins/blurOnEsc'
import { diagnosticTooltipCloseButton } from '@src/editor/plugins/diagnosticTooltipCloseButton'
import { executionEffectsExtension } from '@src/editor/plugins/execution'
import { operationsExtension } from '@src/editor/plugins/operations'
import { sketchSceneGraphCompartment } from '@src/editor/plugins/sketch'
import { themeCompartment } from '@src/editor/plugins/theme'
import { writeEffectsExtension } from '@src/editor/plugins/write'
import { kclLspExtension } from '@src/lang/lsp/codeMirror'
import { onMouseDragMakeANewNumber, onMouseDragRegex } from '@src/lib/utils'

export const lineWrappingCompartment = new Compartment()
export const cursorBlinkingCompartment = new Compartment()

export function baseEditorExtensions() {
  const extensions: Extension = [
    executionEffectsExtension(),
    // Toggled on while in sketch mode
    sketchSceneGraphCompartment.of([]),
    writeEffectsExtension(),
    kclLspExtension(),
    lineWrappingCompartment.of([]),
    cursorBlinkingCompartment.of(
      drawSelection({
        cursorBlinkRate: 1200,
      })
    ),
    lineHighlightField,
    historyCompartment.of(createHistoryExtension()),
    localHistoryTarget.of([]),
    kclAstExtension(),
    operationsExtension(),
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
    diagnosticTooltipCloseButton(),
    blurOnEscape,
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
