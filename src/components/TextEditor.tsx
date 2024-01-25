import ReactCodeMirror, {
  Extension,
  ViewUpdate,
  keymap,
} from '@uiw/react-codemirror'
import { FromServer, IntoServer } from 'editor/lsp/codec'
import Server from '../editor/lsp/server'
import Client from '../editor/lsp/client'
import { TEST } from 'env'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { useConvertToVariable } from 'hooks/useToolbarGuards'
import { Themes } from 'lib/theme'
import { useMemo } from 'react'
import { linter, lintGutter } from '@codemirror/lint'
import { useStore } from 'useStore'
import { processCodeMirrorRanges } from 'lib/selections'
import { LanguageServerClient } from 'editor/lsp'
import kclLanguage from 'editor/lsp/language'
import { EditorView, lineHighlightField } from 'editor/highlightextension'
import { roundOff } from 'lib/utils'
import { kclErrToDiagnostic } from 'lang/errors'
import { CSSRuleObject } from 'tailwindcss/types/config'
import { useModelingContext } from 'hooks/useModelingContext'
import interact from '@replit/codemirror-interact'
import { engineCommandManager } from '../lang/std/engineConnection'
import { kclManager, useKclContext } from 'lang/KclSingleton'
import { ModelingMachineEvent } from 'machines/modelingMachine'

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
  const {
    editorView,
    isLSPServerReady,
    setEditorView,
    setIsLSPServerReady,
    isShiftDown,
  } = useStore((s) => ({
    editorView: s.editorView,
    isLSPServerReady: s.isLSPServerReady,
    setEditorView: s.setEditorView,
    setIsLSPServerReady: s.setIsLSPServerReady,
    isShiftDown: s.isShiftDown,
  }))
  const { code, errors } = useKclContext()

  const {
    context: { selectionRanges, selectionRangeTypeMap },
    send,
    state,
  } = useModelingContext()

  const { settings: { context: { textWrapping } = {} } = {} } =
    useGlobalStateContext()
  const { commandBarSend } = useCommandsContext()
  const { enable: convertEnabled, handleClick: convertCallback } =
    useConvertToVariable()

  // So this is a bit weird, we need to initialize the lsp server and client.
  // But the server happens async so we break this into two parts.
  // Below is the client and server promise.
  const { lspClient } = useMemo(() => {
    const intoServer: IntoServer = new IntoServer()
    const fromServer: FromServer = FromServer.create()
    const client = new Client(fromServer, intoServer)
    if (!TEST) {
      Server.initialize(intoServer, fromServer).then((lspServer) => {
        lspServer.start()
        setIsLSPServerReady(true)
      })
    }

    const lspClient = new LanguageServerClient({ client })
    return { lspClient }
  }, [setIsLSPServerReady])

  // Here we initialize the plugin which will start the client.
  // When we have multi-file support the name of the file will be a dep of
  // this use memo, as well as the directory structure, which I think is
  // a good setup because it will restart the client but not the server :)
  // We do not want to restart the server, its just wasteful.
  const kclLSP = useMemo(() => {
    let plugin = null
    if (isLSPServerReady && !TEST) {
      // Set up the lsp plugin.
      const lsp = kclLanguage({
        // When we have more than one file, we'll need to change this.
        documentUri: `file:///we-just-have-one-file-for-now.kcl`,
        workspaceFolders: null,
        client: lspClient,
      })

      plugin = lsp
    }
    return plugin
  }, [lspClient, isLSPServerReady])

  // const onChange = React.useCallback((value: string, viewUpdate: ViewUpdate) => {
  const onChange = (newCode: string) => {
    kclManager.setCodeAndExecute(newCode)
  } //, []);
  const onUpdate = (viewUpdate: ViewUpdate) => {
    if (!editorView) {
      setEditorView(viewUpdate.view)
    }
    const eventInfo = processCodeMirrorRanges({
      codeMirrorRanges: viewUpdate.state.selection.ranges,
      selectionRanges,
      selectionRangeTypeMap,
      isShiftDown,
    })
    if (!eventInfo) return
    const ignoreEvents: ModelingMachineEvent['type'][] = ['Equip Line tool 3']
    if (ignoreEvents.includes(state.event.type)) return
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
