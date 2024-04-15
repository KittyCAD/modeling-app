import { undo, redo } from '@codemirror/commands'
import ReactCodeMirror from '@uiw/react-codemirror'
import { TEST } from 'env'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useConvertToVariable } from 'hooks/useToolbarGuards'
import { Themes, getSystemTheme } from 'lib/theme'
import { useMemo, useRef } from 'react'
import { useStore } from 'useStore'
import { processCodeMirrorRanges } from 'lib/selections'
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
import { useModelingContext } from 'hooks/useModelingContext'
import interact from '@replit/codemirror-interact'
import { engineCommandManager, sceneInfra, kclManager } from 'lib/singletons'
import { useKclContext } from 'lang/KclProvider'
import { ModelingMachineEvent } from 'machines/modelingMachine'
import { useHotkeys } from 'react-hotkeys-hook'
import { isTauri } from 'lib/isTauri'
import { useNavigate } from 'react-router-dom'
import { paths } from 'lib/paths'
import makeUrlPathRelative from 'lib/makeUrlPathRelative'
import { useLspContext } from 'components/LspProvider'
import { Prec, EditorState, Extension, SelectionRange } from '@codemirror/state'
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  hasNextSnippetField,
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
  const { editorView, setEditorView, isShiftDown } = useStore((s) => ({
    editorView: s.editorView,
    setEditorView: s.setEditorView,
    isShiftDown: s.isShiftDown,
  }))
  const { code } = useKclContext()
  const lastEvent = useRef({ event: '', time: Date.now() })
  const { copilotLSP, kclLSP } = useLspContext()
  const navigate = useNavigate()

  useHotkeys('mod+z', (e) => {
    e.preventDefault()
    if (editorView) {
      undo(editorView)
    }
  })
  useHotkeys('mod+shift+z', (e) => {
    e.preventDefault()
    if (editorView) {
      redo(editorView)
    }
  })

  const {
    context: { selectionRanges },
    send,
    state,
  } = useModelingContext()

  const { settings } = useSettingsAuthContext()
  const textWrapping = settings.context.textEditor.textWrapping
  const cursorBlinking = settings.context.textEditor.blinkingCursor
  const { commandBarSend } = useCommandsContext()
  const { enable: convertEnabled, handleClick: convertCallback } =
    useConvertToVariable()

  const onChange = async (newCode: string) => {
    // If we are just fucking around in a snippet, return early and don't
    // trigger stuff below that might cause the component to re-render.
    // Otherwise we will not be able to tab thru the snippet portions.
    // We explicitly dont check HasPrevSnippetField because we always add
    // a ${} to the end of the function so that's fine.
    if (editorView && hasNextSnippetField(editorView.state)) {
      return
    }

    kclManager.setCode(newCode)
  }
  const lastSelection = useRef('')
  const onUpdate = (viewUpdate: ViewUpdate) => {
    // If we are just fucking around in a snippet, return early and don't
    // trigger stuff below that might cause the component to re-render.
    // Otherwise we will not be able to tab thru the snippet portions.
    // We explicitly dont check HasPrevSnippetField because we always add
    // a ${} to the end of the function so that's fine.
    if (hasNextSnippetField(viewUpdate.view.state)) {
      return
    }
    if (!editorView) {
      setEditorView(viewUpdate.view)
    }
    const selString = stringifyRanges(
      viewUpdate?.state?.selection?.ranges || []
    )
    if (selString === lastSelection.current) {
      // onUpdate is noisy and is fired a lot by extensions
      // since we're only interested in selections changes we can ignore most of these.
      return
    }
    lastSelection.current = selString

    if (
      // TODO find a less lazy way of getting the last
      Date.now() - useStore.getState().lastCodeMirrorSelectionUpdatedFromScene <
      150
    )
      return // update triggered by scene selection
    if (sceneInfra.selected) return // mid drag
    const ignoreEvents: ModelingMachineEvent['type'][] = [
      'Equip Line tool',
      'Equip tangential arc to',
    ]
    if (ignoreEvents.includes(state.event.type)) return
    const eventInfo = processCodeMirrorRanges({
      codeMirrorRanges: viewUpdate.state.selection.ranges,
      selectionRanges,
      isShiftDown,
    })
    if (!eventInfo) return
    const deterministicEventInfo = {
      ...eventInfo,
      engineEvents: eventInfo.engineEvents.map((e) => ({
        ...e,
        cmd_id: 'static',
      })),
    }
    const stringEvent = JSON.stringify(deterministicEventInfo)
    if (
      stringEvent === lastEvent.current.event &&
      Date.now() - lastEvent.current.time < 500
    )
      return // don't repeat events
    lastEvent.current = { event: stringEvent, time: Date.now() }
    send(eventInfo.modelingEvent)
    eventInfo.engineEvents.forEach((event) =>
      engineCommandManager.sendSceneCommand(event)
    )
  }

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
            commandBarSend({ type: 'Open' })
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
            if (convertEnabled) {
              convertCallback()
              return true
            }
            return false
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
        lintGutter(),
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
  }, [kclLSP, textWrapping.current, cursorBlinking.current, convertCallback])

  return (
    <div
      id="code-mirror-override"
      className={'absolute inset-0 ' + (cursorBlinking.current ? 'blink' : '')}
    >
      <ReactCodeMirror
        value={code}
        extensions={editorExtensions}
        onChange={onChange}
        onUpdate={onUpdate}
        theme={theme}
        onCreateEditor={(_editorView) => setEditorView(_editorView)}
        indentWithTab={false}
        basicSetup={false}
      />
    </div>
  )
}

function stringifyRanges(ranges: readonly SelectionRange[]): string {
  return ranges.map(({ to, from }) => `${to}->${from}`).join('&')
}
