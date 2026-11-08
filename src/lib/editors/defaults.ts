import { editorAppearance } from '@src/editor/plugins/theme/appearance'
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language'
import { lintGutter, lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import type { CodeEditorHost } from '@src/lib/editors/registry/contract'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

/** Standard editing behavior shared by every file, independent of modeling and storage. */
export function defaultEditorExtensions({ editor, view }: CodeEditorHost) {
  const runHistory = (redo: boolean) => {
    const changed = redo ? editor.redo() : editor.undo()
    if (changed)
      view.dispatch({ selection: editor.state.selection, scrollIntoView: true })
    return changed
  }
  return [
    editorAppearance(),
    EditorView.domEventHandlers({
      beforeinput: (event) => {
        if (
          event.inputType !== 'historyUndo' &&
          event.inputType !== 'historyRedo'
        )
          return false
        event.preventDefault()
        return event.inputType === 'historyUndo'
          ? runHistory(false)
          : runHistory(true)
      },
    }),
    drawSelection({ cursorBlinkRate: 1200 }),
    closeBrackets(),
    codeFolding(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      { key: 'Mod-z', run: () => runHistory(false), preventDefault: true },
      { key: 'Mod-Shift-z', run: () => runHistory(true), preventDefault: true },
      { key: 'Mod-y', run: () => runHistory(true), preventDefault: true },
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
    highlightActiveLine(),
    highlightSelectionMatches(),
    rectangularSelection(),
    dropCursor(),
  ]
}
