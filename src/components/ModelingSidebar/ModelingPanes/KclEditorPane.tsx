import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  codeFolding,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { diagnosticCount, lintGutter, lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import { EditorState, Prec, Transaction } from '@codemirror/state'
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
import interact from '@replit/codemirror-interact'
import env from '@src/env'
import { useSelector } from '@xstate/react'
import { useEffect, useMemo, useRef } from 'react'

import { useLspContext } from '@src/components/LspProvider'
import CodeEditor from '@src/components/ModelingSidebar/ModelingPanes/CodeEditor'
import { lineHighlightField } from '@src/editor/highlightextension'
import { modelingMachineEvent } from '@src/editor/manager'
import { historyCompartment } from '@src/editor/compartments'
import { codeManager, editorManager, kclManager } from '@src/lib/singletons'
import { Themes, getSystemTheme } from '@src/lib/theme'
import { onMouseDragMakeANewNumber, onMouseDragRegex } from '@src/lib/utils'
import { useSettings } from '@src/lib/singletons'
import {
  editorIsMountedSelector,
  kclEditorActor,
  selectionEventSelector,
} from '@src/machines/kclEditorMachine'
import { reportRejection } from '@src/lib/trap'

export const editorShortcutMeta = {
  formatCode: {
    display: 'Alt + Shift + F',
  },
  convertToVariable: {
    codeMirror: 'Ctrl-Shift-c',
    display: 'Ctrl + Shift + C',
  },
}

export const KclEditorPane = () => {
  const context = useSettings()
  const lastSelectionEvent = useSelector(kclEditorActor, selectionEventSelector)
  const editorIsMounted = useSelector(kclEditorActor, editorIsMountedSelector)
  const theme =
    context.app.theme.current === Themes.System
      ? getSystemTheme()
      : context.app.theme.current
  const { copilotLSP, kclLSP } = useLspContext()

  // When this component unmounts, we need to tell the machine that the editor
  useEffect(() => {
    return () => {
      kclEditorActor.send({ type: 'setKclEditorMounted', data: false })
      kclEditorActor.send({ type: 'setLastSelectionEvent', data: undefined })
      kclManager.diagnostics = []
    }
  }, [])

  useEffect(() => {
    const editorView = editorManager.getEditorView()
    if (!editorIsMounted || !lastSelectionEvent || !editorView) {
      return
    }

    try {
      editorView.dispatch({
        selection: lastSelectionEvent.codeMirrorSelection,
        annotations: [modelingMachineEvent, Transaction.addToHistory.of(false)],
        scrollIntoView: lastSelectionEvent.scrollIntoView,
      })
    } catch (e) {
      console.error('Error setting selection', e)
    }
  }, [editorIsMounted, lastSelectionEvent])

  const textWrapping = context.textEditor.textWrapping
  const cursorBlinking = context.textEditor.blinkingCursor
  // DO NOT ADD THE CODEMIRROR HOTKEYS HERE TO THE DEPENDENCY ARRAY
  // It reloads the editor every time we do _anything_ in the editor
  // I have no idea why.
  // Instead, hot load hotkeys via code mirror native.
  const codeMirrorHotkeys = codeManager.getCodemirrorHotkeys()

  // When opening the editor, use the existing history in editorManager.
  // This is needed to ensure users can undo beyond when the editor has been openeed.
  // (Another solution would be to reuse the same state instead of creating a new one in CodeEditor.)
  const existingHistory = editorManager.editorState.field(historyField)
  const initialHistory = existingHistory
    ? historyField.init(() => existingHistory)
    : history()

  const editorExtensions = useMemo(() => {
    const extensions = [
      drawSelection({
        cursorBlinkRate: cursorBlinking.current ? 1200 : 0,
      }),
      lineHighlightField,
      historyCompartment.of(initialHistory),
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
        ...codeMirrorHotkeys,
        {
          key: editorShortcutMeta.convertToVariable.codeMirror,
          run: () => {
            return editorManager.convertToVariable()
          },
        },
      ]),
    ] as Extension[]

    if (kclLSP) extensions.push(Prec.highest(kclLSP))
    if (copilotLSP) extensions.push(copilotLSP)

    // These extensions have proven to mess with vitest
    if (env().NODE_ENV !== 'test') {
      extensions.push(
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
        syntaxHighlighting(defaultHighlightStyle, {
          fallback: true,
        }),
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
        })
      )
      if (textWrapping.current) extensions.push(EditorView.lineWrapping)
    }

    return extensions
  }, [kclLSP, copilotLSP, textWrapping.current, cursorBlinking.current])

  const initialCode = useRef(codeManager.code)

  return (
    <div className="relative">
      <div
        id="code-mirror-override"
        className={
          'absolute inset-0 ' + (cursorBlinking.current ? 'blink' : '')
        }
      >
        <CodeEditor
          initialDocValue={initialCode.current}
          extensions={editorExtensions}
          theme={theme}
          onCreateEditor={(_editorView) => {
            editorManager.setEditorView(_editorView)

            if (!_editorView) return

            // Update diagnostics as they are cleared when the editor is unmounted.
            // Without this, errors would not be shown when closing and reopening the editor.
            kclManager
              .safeParse(codeManager.code)
              .then(() => {
                // On first load of this component, ensure we show the current errors
                // in the editor.
                // Make sure we don't add them twice.
                if (diagnosticCount(_editorView.state) === 0) {
                  kclManager.setDiagnosticsForCurrentErrors()
                }
              })
              .catch(reportRejection)
          }}
        />
      </div>
    </div>
  )
}
