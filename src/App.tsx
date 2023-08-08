import {
  useRef,
  useEffect,
  useMemo,
  useCallback,
  MouseEventHandler,
} from 'react'
import { DebugPanel } from './components/DebugPanel'
import { v4 as uuidv4 } from 'uuid'
import { asyncLexer } from './lang/tokeniser'
import { abstractSyntaxTree } from './lang/abstractSyntaxTree'
import {
  _executor,
  ProgramMemory,
  ExtrudeGroup,
  SketchGroup,
} from './lang/executor'
import CodeMirror from '@uiw/react-codemirror'
import { langs } from '@uiw/codemirror-extensions-langs'
import { linter, lintGutter } from '@codemirror/lint'
import { ViewUpdate } from '@codemirror/view'
import {
  lineHighlightField,
  addLineHighlight,
} from './editor/highlightextension'
import { PaneType, Selections, useStore } from './useStore'
import { Logs, KCLErrors } from './components/Logs'
import { CollapsiblePanel } from './components/CollapsiblePanel'
import { MemoryPanel } from './components/MemoryPanel'
import { useHotKeyListener } from './hooks/useHotKeyListener'
import { Stream } from './components/Stream'
import ModalContainer from 'react-modal-promise'
import {
  EngineCommand,
  EngineCommandManager,
} from './lang/std/engineConnection'
import { isOverlap, throttle } from './lib/utils'
import { AppHeader } from './components/AppHeader'
import { KCLError, kclErrToDiagnostic } from './lang/errors'
import { Resizable } from 're-resizable'
import {
  faCode,
  faCodeCommit,
  faSquareRootVariable,
} from '@fortawesome/free-solid-svg-icons'
import { useHotkeys } from 'react-hotkeys-hook'
import { TEST } from './env'

export function App() {
  const cam = useRef()
  useHotKeyListener()
  const {
    editorView,
    setEditorView,
    setSelectionRanges,
    selectionRanges,
    addLog,
    addKCLError,
    code,
    setCode,
    setAst,
    setError,
    setProgramMemory,
    resetLogs,
    resetKCLErrors,
    selectionRangeTypeMap,
    setArtifactMap,
    engineCommandManager: _engineCommandManager,
    setEngineCommandManager,
    setHighlightRange,
    setCursor2,
    sourceRangeMap,
    setMediaStream,
    setIsStreamReady,
    isStreamReady,
    isMouseDownInStream,
    fileId,
    cmdId,
    setCmdId,
    token,
    formatCode,
    debugPanel,
    theme,
    openPanes,
    setOpenPanes,
    onboardingStatus,
  } = useStore((s) => ({
    editorView: s.editorView,
    setEditorView: s.setEditorView,
    setSelectionRanges: s.setSelectionRanges,
    selectionRanges: s.selectionRanges,
    setGuiMode: s.setGuiMode,
    addLog: s.addLog,
    code: s.code,
    setCode: s.setCode,
    setAst: s.setAst,
    setError: s.setError,
    setProgramMemory: s.setProgramMemory,
    resetLogs: s.resetLogs,
    resetKCLErrors: s.resetKCLErrors,
    selectionRangeTypeMap: s.selectionRangeTypeMap,
    setArtifactMap: s.setArtifactNSourceRangeMaps,
    engineCommandManager: s.engineCommandManager,
    setEngineCommandManager: s.setEngineCommandManager,
    setHighlightRange: s.setHighlightRange,
    isShiftDown: s.isShiftDown,
    setCursor: s.setCursor,
    setCursor2: s.setCursor2,
    sourceRangeMap: s.sourceRangeMap,
    setMediaStream: s.setMediaStream,
    isStreamReady: s.isStreamReady,
    setIsStreamReady: s.setIsStreamReady,
    isMouseDownInStream: s.isMouseDownInStream,
    fileId: s.fileId,
    cmdId: s.cmdId,
    setCmdId: s.setCmdId,
    token: s.token,
    formatCode: s.formatCode,
    debugPanel: s.debugPanel,
    addKCLError: s.addKCLError,
    theme: s.theme,
    openPanes: s.openPanes,
    setOpenPanes: s.setOpenPanes,
    onboardingStatus: s.onboardingStatus,
  }))

  // Pane toggling keyboard shortcuts
  const togglePane = useCallback(
    (newPane: PaneType) =>
      openPanes.includes(newPane)
        ? setOpenPanes(openPanes.filter((p) => p !== newPane))
        : setOpenPanes([...openPanes, newPane]),
    [openPanes, setOpenPanes]
  )
  useHotkeys('shift + c', () => togglePane('code'))
  useHotkeys('shift + v', () => togglePane('variables'))
  useHotkeys('shift + l', () => togglePane('logs'))
  useHotkeys('shift + e', () => togglePane('kclErrors'))
  useHotkeys('shift + d', () => togglePane('debug'))

  const paneOpacity =
    onboardingStatus === 'camera'
      ? 'opacity-20'
      : isMouseDownInStream
      ? 'opacity-40'
      : ''

  // const onChange = React.useCallback((value: string, viewUpdate: ViewUpdate) => {
  const onChange = (value: string, viewUpdate: ViewUpdate) => {
    setCode(value)
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

    _engineCommandManager?.cusorsSelected({
      otherSelections: [],
      idBasedSelections,
    })

    setSelectionRanges({
      otherSelections: [],
      codeBasedSelections,
    })
  }
  const engineCommandManager = useMemo(() => {
    return new EngineCommandManager({
      setMediaStream,
      setIsStreamReady,
      token,
    })
  }, [token])
  useEffect(() => {
    return () => {
      engineCommandManager?.tearDown()
    }
  }, [engineCommandManager])

  useEffect(() => {
    if (!isStreamReady) return
    const asyncWrap = async () => {
      try {
        if (!code) {
          setAst(null)
          return
        }
        const tokens = await asyncLexer(code)
        const _ast = abstractSyntaxTree(tokens)
        setAst(_ast)
        resetLogs()
        resetKCLErrors()
        if (_engineCommandManager) {
          _engineCommandManager.endSession()
        }
        engineCommandManager.startNewSession()
        setEngineCommandManager(engineCommandManager)
        try {
          const programMemory = await _executor(
            _ast,
            {
              root: {
                log: {
                  type: 'userVal',
                  value: (a: any) => {
                    addLog(a)
                  },
                  __meta: [
                    {
                      pathToNode: [],
                      sourceRange: [0, 0],
                    },
                  ],
                },
                _0: {
                  type: 'userVal',
                  value: 0,
                  __meta: [],
                },
                _90: {
                  type: 'userVal',
                  value: 90,
                  __meta: [],
                },
                _180: {
                  type: 'userVal',
                  value: 180,
                  __meta: [],
                },
                _270: {
                  type: 'userVal',
                  value: 270,
                  __meta: [],
                },
              },
              pendingMemory: {},
            },
            engineCommandManager,
            { bodyType: 'root' },
            []
          ).catch((e) => {
            console.error("Caught an exception")
            return undefined
          })

          const { artifactMap, sourceRangeMap } =
            await engineCommandManager.waitForAllCommands()

          setArtifactMap({ artifactMap, sourceRangeMap })
          engineCommandManager.onHover((id) => {
            if (!id) {
              setHighlightRange([0, 0])
            } else {
              const sourceRange = sourceRangeMap[id]
              setHighlightRange(sourceRange)
            }
          })
          engineCommandManager.onClick(({ id, type }) => {
            setCursor2({ range: sourceRangeMap[id], type })
          })
          if (programMemory !== undefined) {
            setProgramMemory(programMemory)
          }
        } catch (e) {
          console.error(e)
        }

        setError()
      } catch (e: any) {
        if (e instanceof KCLError) {
          addKCLError(e)
        } else {
          setError('problem')
          console.log(e)
          addLog(e)
        }
      }
    }
    asyncWrap()
  }, [code, isStreamReady])

  const debounceSocketSend = throttle<EngineCommand>((message) => {
    engineCommandManager?.sendSceneCommand(message)
  }, 16)
  const handleMouseMove = useCallback<MouseEventHandler<HTMLDivElement>>(
    ({ clientX, clientY, ctrlKey, currentTarget }) => {
      if (!cmdId) return
      if (!isMouseDownInStream) return

      const { left, top } = currentTarget.getBoundingClientRect()
      const x = clientX - left
      const y = clientY - top
      const interaction = ctrlKey ? 'pan' : 'rotate'

      const newCmdId = uuidv4()
      setCmdId(newCmdId)

      debounceSocketSend({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'camera_drag_move',
          interaction,
          window: { x, y },
        },
        cmd_id: newCmdId,
        file_id: fileId,
      })
    },
    [debounceSocketSend, isMouseDownInStream, cmdId, fileId, setCmdId]
  )

  const extraExtensions = useMemo(() => {
    if (TEST) return []
    return [
      lintGutter(),
      linter((_view) => {
        return kclErrToDiagnostic(useStore.getState().kclErrors)
      }),
    ]
  }, [])

  return (
    <div
      className="h-screen relative flex flex-col"
      onMouseMove={handleMouseMove}
    >
      <AppHeader
        className={
          'transition-opacity transition-duration-75 ' +
          paneOpacity +
          (isMouseDownInStream ? ' pointer-events-none' : '')
        }
      />
      <ModalContainer />
      <Resizable
        className={
          'z-10 my-5 ml-5 pr-1 flex flex-col flex-grow overflow-hidden transition-opacity transition-duration-75 ' +
          (isMouseDownInStream || onboardingStatus === 'camera'
            ? ' pointer-events-none '
            : ' ') +
          paneOpacity
        }
        defaultSize={{
          width: '400px',
          height: 'auto',
        }}
        minWidth={200}
        maxWidth={600}
        minHeight={'auto'}
        maxHeight={'auto'}
        handleClasses={{
          right:
            'hover:bg-liquid-30/40 dark:hover:bg-liquid-10/40 bg-transparent transition-colors duration-100 transition-ease-out delay-100',
        }}
      >
        <CollapsiblePanel
          title="Code"
          icon={faCode}
          className="open:!mb-2"
          open={openPanes.includes('code')}
        >
          <div className="px-2 py-1">
            <button
              // disabled={!shouldFormat}
              onClick={formatCode}
              // className={`${!shouldFormat && 'text-gray-300'}`}
            >
              format
            </button>
          </div>
          <div id="code-mirror-override">
            <CodeMirror
              className="h-full"
              value={code}
              extensions={[
                langs.javascript({ jsx: true }),
                lineHighlightField,
                ...extraExtensions,
              ]}
              onChange={onChange}
              onUpdate={onUpdate}
              theme={theme}
              onCreateEditor={(_editorView) => setEditorView(_editorView)}
            />
          </div>
        </CollapsiblePanel>
        <section className="flex flex-col mt-auto">
          <MemoryPanel
            theme={theme}
            open={openPanes.includes('variables')}
            title="Variables"
            icon={faSquareRootVariable}
          />
          <Logs
            theme={theme}
            open={openPanes.includes('logs')}
            title="Logs"
            icon={faCodeCommit}
          />
          <KCLErrors
            theme={theme}
            open={openPanes.includes('kclErrors')}
            title="KCL Errors"
            iconClassNames={{ icon: 'group-open:text-destroy-30' }}
          />
        </section>
      </Resizable>
      <Stream className="absolute inset-0 z-0" />
      {debugPanel && (
        <DebugPanel
          title="Debug"
          className={
            'transition-opacity transition-duration-75 ' +
            paneOpacity +
            (isMouseDownInStream ? ' pointer-events-none' : '')
          }
          open={openPanes.includes('debug')}
        />
      )}
    </div>
  )
}
