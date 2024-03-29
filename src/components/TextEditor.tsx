import { undo, redo } from '@codemirror/commands'
import ReactCodeMirror, {
  Extension,
  ViewUpdate,
  keymap,
  SelectionRange,
} from '@uiw/react-codemirror'
import { TEST } from 'env'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useConvertToVariable } from 'hooks/useToolbarGuards'
import { Themes } from 'lib/theme'
import { useEffect, useMemo, useRef } from 'react'
import { linter, lintGutter } from '@codemirror/lint'
import { useStore } from 'useStore'
import { processCodeMirrorRanges } from 'lib/selections'
import { EditorView, lineHighlightField } from 'editor/highlightextension'
import { roundOff } from 'lib/utils'
import { kclErrToDiagnostic } from 'lang/errors'
import { CSSRuleObject } from 'tailwindcss/types/config'
import { useModelingContext } from 'hooks/useModelingContext'
import interact from '@replit/codemirror-interact'
import { engineCommandManager, sceneInfra, kclManager } from 'lib/singletons'
import { useKclContext } from 'lang/KclProvider'
import { ModelingMachineEvent } from 'machines/modelingMachine'
import { NetworkHealthState, useNetworkStatus } from './NetworkHealthIndicator'
import { useHotkeys } from 'react-hotkeys-hook'
import { useLspContext } from './LspProvider'

export const editorShortcutMeta = {
  formatCode: {
    codeMirror: 'Alt-Shift-f',
    display: 'Alt + Shift + F',
  },
  convertToVariable: {
    codeMirror: 'Ctrl-Shift-c',
    display: 'Ctrl + Shift + C',
  },
}

export const TextEditor = ({
  theme,
}: {
  theme: Themes.Light | Themes.Dark
}) => {
  const { editorView, setEditorView, isShiftDown } = useStore((s) => ({
    editorView: s.editorView,
    setEditorView: s.setEditorView,
    isShiftDown: s.isShiftDown,
  }))
  const { code, errors } = useKclContext()
  const lastEvent = useRef({ event: '', time: Date.now() })
  const { overallState } = useNetworkStatus()
  const isNetworkOkay = overallState === NetworkHealthState.Ok
  const { copilotLSP, kclLSP } = useLspContext()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onlineCallback = () => kclManager.setCodeAndExecute(kclManager.code)
    window.addEventListener('online', onlineCallback)
    return () => window.removeEventListener('online', onlineCallback)
  }, [])

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
  const textWrapping = settings.context?.textWrapping ?? 'On'
  const { commandBarSend } = useCommandsContext()
  const { enable: convertEnabled, handleClick: convertCallback } =
    useConvertToVariable()

  // const onChange = React.useCallback((value: string, viewUpdate: ViewUpdate) => {
  const onChange = async (newCode: string) => {
    if (isNetworkOkay) kclManager.setCodeAndExecute(newCode)
    else kclManager.setCode(newCode)
  } //, []);
  const lastSelection = useRef('')
  const onUpdate = (viewUpdate: ViewUpdate) => {
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
      lineHighlightField,
      keymap.of([
        {
          key: 'Meta-k',
          run: () => {
            commandBarSend({ type: 'Open' })
            return false
          },
        },
        {
          key: editorShortcutMeta.formatCode.codeMirror,
          run: () => {
            kclManager.format()
            return true
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

    if (kclLSP) extensions.push(kclLSP)
    if (copilotLSP) extensions.push(copilotLSP)

    // These extensions have proven to mess with vitest
    if (!TEST) {
      extensions.push(
        lintGutter(),
        linter((_view) => {
          return kclErrToDiagnostic(errors)
        }),
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
      if (textWrapping === 'On') extensions.push(EditorView.lineWrapping)
    }

    return extensions
  }, [kclLSP, textWrapping, convertCallback])

  return (
    <div
      id="code-mirror-override"
      className="full-height-subtract"
      style={{ '--height-subtract': '4.25rem' } as CSSRuleObject}
    >
      <ReactCodeMirror
        className="h-full"
        value={code}
        extensions={editorExtensions}
        onChange={onChange}
        onUpdate={onUpdate}
        theme={theme}
        onCreateEditor={(_editorView) => setEditorView(_editorView)}
      />
    </div>
  )
}

function stringifyRanges(ranges: readonly SelectionRange[]): string {
  return ranges.map(({ to, from }) => `${to}->${from}`).join('&')
}
