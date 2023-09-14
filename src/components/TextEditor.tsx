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
import { Selections, useStore } from 'useStore'
import { LanguageServerClient } from 'editor/lsp'
import kclLanguage from 'editor/lsp/language'
import { isTauri } from 'lib/isTauri'
import { useParams } from 'react-router-dom'
import { writeTextFile } from '@tauri-apps/api/fs'
import { PROJECT_ENTRYPOINT } from 'lib/tauriFS'
import { toast } from 'react-hot-toast'
import {
  EditorView,
  addLineHighlight,
  lineHighlightField,
} from 'editor/highlightextension'
import { isOverlap, roundOff } from 'lib/utils'
import { kclErrToDiagnostic } from 'lang/errors'
import { CSSRuleObject } from 'tailwindcss/types/config'
import interact from '@replit/codemirror-interact'

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
  const pathParams = useParams()
  const {
    code,
    deferredSetCode,
    editorView,
    engineCommandManager,
    formatCode,
    isLSPServerReady,
    selectionRanges,
    selectionRangeTypeMap,
    setEditorView,
    setIsLSPServerReady,
    setSelectionRanges,
    sourceRangeMap,
  } = useStore((s) => ({
    code: s.code,
    deferredSetCode: s.deferredSetCode,
    editorView: s.editorView,
    engineCommandManager: s.engineCommandManager,
    formatCode: s.formatCode,
    isLSPServerReady: s.isLSPServerReady,
    selectionRanges: s.selectionRanges,
    selectionRangeTypeMap: s.selectionRangeTypeMap,
    setEditorView: s.setEditorView,
    setIsLSPServerReady: s.setIsLSPServerReady,
    setSelectionRanges: s.setSelectionRanges,
    sourceRangeMap: s.sourceRangeMap,
  }))

  const {
    settings: {
      context: { textWrapping },
    },
  } = useGlobalStateContext()
  const { setCommandBarOpen } = useCommandsContext()
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
  // a good setup becuase it will restart the client but not the server :)
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
  const onChange = (value: string, viewUpdate: ViewUpdate) => {
    deferredSetCode(value)
    if (isTauri() && pathParams.id) {
      // Save the file to disk
      // Note that PROJECT_ENTRYPOINT is hardcoded until we support multiple files
      writeTextFile(pathParams.id + '/' + PROJECT_ENTRYPOINT, value).catch(
        (err) => {
          // TODO: add Sentry per GH issue #254 (https://github.com/KittyCAD/modeling-app/issues/254)
          console.error('error saving file', err)
          toast.error('Error saving file, please check file permissions')
        }
      )
    }
    if (editorView) {
      editorView?.dispatch({ effects: addLineHighlight.of([0, 0]) })
    }
  } //, []);
  const onUpdate = (viewUpdate: ViewUpdate) => {
    if (!editorView) {
      setEditorView(viewUpdate.view)
    }
    const ranges = viewUpdate.state.selection.ranges

    const isChange =
      ranges.length !== selectionRanges.codeBasedSelections.length ||
      ranges.some(({ from, to }, i) => {
        return (
          from !== selectionRanges.codeBasedSelections[i].range[0] ||
          to !== selectionRanges.codeBasedSelections[i].range[1]
        )
      })

    if (!isChange) return
    const codeBasedSelections: Selections['codeBasedSelections'] = ranges.map(
      ({ from, to }) => {
        if (selectionRangeTypeMap[to]) {
          return {
            type: selectionRangeTypeMap[to],
            range: [from, to],
          }
        }
        return {
          type: 'default',
          range: [from, to],
        }
      }
    )
    const idBasedSelections = codeBasedSelections
      .map(({ type, range }) => {
        const hasOverlap = Object.entries(sourceRangeMap).filter(
          ([_, sourceRange]) => {
            return isOverlap(sourceRange, range)
          }
        )
        if (hasOverlap.length) {
          return {
            type,
            id: hasOverlap[0][0],
          }
        }
      })
      .filter(Boolean) as any

    engineCommandManager?.cusorsSelected({
      otherSelections: [],
      idBasedSelections,
    })

    setSelectionRanges({
      otherSelections: [],
      codeBasedSelections,
    })
  }

  const editorExtensions = useMemo(() => {
    const extensions = [
      lineHighlightField,
      keymap.of([
        {
          key: 'Meta-k',
          run: () => {
            setCommandBarOpen(true)
            return false
          },
        },
        {
          key: editorShortcutMeta.formatCode.codeMirror,
          run: () => {
            formatCode()
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
          return kclErrToDiagnostic(useStore.getState().kclErrors)
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
  }, [kclLSP, textWrapping])

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
