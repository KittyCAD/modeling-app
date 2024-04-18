import ReactCodeMirror from '@uiw/react-codemirror'
import { TEST } from 'env'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { Themes, getSystemTheme } from 'lib/theme'
import { useEffect, useMemo } from 'react'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { lineHighlightField } from 'editor/highlightextension'
import { roundOff } from 'lib/utils'
import {
  lineNumbers,
  rectangularSelection,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightActiveLine,
  keymap,
  EditorView,
  dropCursor,
  drawSelection,
  ViewUpdate,
} from '@codemirror/view'
import {
  indentWithTab,
  defaultKeymap,
  historyKeymap,
  history,
} from '@codemirror/commands'
import { lintGutter, lintKeymap } from '@codemirror/lint'
import {
  foldGutter,
  foldKeymap,
  bracketMatching,
  indentOnInput,
  codeFolding,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language'
import interact from '@replit/codemirror-interact'
import { kclManager, editorManager } from 'lib/singletons'
import { useKclContext } from 'lang/KclProvider'
import { useHotkeys } from 'react-hotkeys-hook'
import { isTauri } from 'lib/isTauri'
import { useNavigate } from 'react-router-dom'
import { paths } from 'lib/paths'
import makeUrlPathRelative from 'lib/makeUrlPathRelative'
import { useLspContext } from 'components/LspProvider'
import { Prec, EditorState, Extension } from '@codemirror/state'
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'

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
  const {
    settings: { context },
  } = useSettingsAuthContext()
  const theme =
    context.app.theme.current === Themes.System
      ? getSystemTheme()
      : context.app.theme.current
  const { editorCode } = useKclContext()
  const { copilotLSP, kclLSP } = useLspContext()
  const navigate = useNavigate()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onlineCallback = () => kclManager.executeCode(true)
    window.addEventListener('online', onlineCallback)
    return () => window.removeEventListener('online', onlineCallback)
  }, [])

  useHotkeys('mod+z', (e) => {
    e.preventDefault()
    editorManager.undo()
  })
  useHotkeys('mod+shift+z', (e) => {
    e.preventDefault()
    editorManager.redo()
  })

  const textWrapping = context.textEditor.textWrapping
  const cursorBlinking = context.textEditor.blinkingCursor

  const editorExtensions = useMemo(() => {
    const extensions = [
      drawSelection({
        cursorBlinkRate: cursorBlinking.current ? 1200 : 0,
      }),
      lineHighlightField,
      history(),
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
        {
          key: 'Meta-k',
          run: () => {
            editorManager.commandBarSend({ type: 'Open' })
            return false
          },
        },
        {
          key: isTauri() ? 'Meta-,' : 'Meta-Shift-,',
          run: () => {
            navigate(makeUrlPathRelative(paths.SETTINGS))
            return false
          },
        },
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
    if (!TEST) {
      extensions.push(
        lintGutter(),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        rectangularSelection(),
        drawSelection(),
        dropCursor(),
        interact({
          rules: [
            // a rule for a number dragger
            {
              // the regexp matching the value
              regexp: /-?\b\d+\.?\d*\b/g,
              // set cursor to "ew-resize" on hover
              cursor: 'ew-resize',
              // change number value based on mouse X movement on drag
              onDrag: (text, setText, e) => {
                const multiplier =
                  e.shiftKey && e.metaKey
                    ? 0.01
                    : e.metaKey
                    ? 0.1
                    : e.shiftKey
                    ? 10
                    : 1

                const delta = e.movementX * multiplier

                const newVal = roundOff(
                  Number(text) + delta,
                  multiplier === 0.01 ? 2 : multiplier === 0.1 ? 1 : 0
                )

                if (isNaN(newVal)) return
                setText(newVal.toString())
              },
            },
          ],
        })
      )
      if (textWrapping.current) extensions.push(EditorView.lineWrapping)
    }

    return extensions
  }, [kclLSP, copilotLSP, textWrapping.current, cursorBlinking.current])

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const updateDelay = 100

  return (
    <div
      id="code-mirror-override"
      className={'absolute inset-0 ' + (cursorBlinking.current ? 'blink' : '')}
    >
      <ReactCodeMirror
        value={editorCode}
        extensions={editorExtensions}
        theme={theme}
        onCreateEditor={(_editorView) =>
          editorManager.setEditorView(_editorView)
        }
        onUpdate={(view: ViewUpdate) => {
          // debounce the view update.
          // otherwise it is laggy for typing.
          if (debounceTimer) {
            clearTimeout(debounceTimer)
          }

          debounceTimer = setTimeout(() => {
            editorManager.handleOnViewUpdate(view)
          }, updateDelay)
        }}
        indentWithTab={false}
        basicSetup={false}
      />
    </div>
  )
}
