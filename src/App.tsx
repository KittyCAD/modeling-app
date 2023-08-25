import {
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  MouseEventHandler,
} from 'react'
import { DebugPanel } from './components/DebugPanel'
import { v4 as uuidv4 } from 'uuid'
import { asyncParser } from './lang/abstractSyntaxTree'
import { _executor } from './lang/executor'
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
import { getNormalisedCoordinates } from './lib/utils'
import { Themes, getSystemTheme } from './lib/theme'
import { isTauri } from './lib/isTauri'
import { useLoaderData, useParams } from 'react-router-dom'
import { writeTextFile } from '@tauri-apps/api/fs'
import { PROJECT_ENTRYPOINT } from './lib/tauriFS'
import { IndexLoaderData } from './Router'
import { toast } from 'react-hot-toast'
import { useAuthMachine } from './hooks/useAuthMachine'

export function App() {
  const { code: loadedCode, project } = useLoaderData() as IndexLoaderData
  const pathParams = useParams()
  const streamRef = useRef<HTMLDivElement>(null)
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
    engineCommandManager,
    setEngineCommandManager,
    setHighlightRange,
    setCursor2,
    sourceRangeMap,
    setMediaStream,
    setIsStreamReady,
    isStreamReady,
    isMouseDownInStream,
    cmdId,
    setCmdId,
    formatCode,
    debugPanel,
    theme,
    openPanes,
    setOpenPanes,
    onboardingStatus,
    didDragInStream,
    setDidDragInStream,
    setStreamDimensions,
    streamDimensions,
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
    cmdId: s.cmdId,
    setCmdId: s.setCmdId,
    formatCode: s.formatCode,
    debugPanel: s.debugPanel,
    addKCLError: s.addKCLError,
    theme: s.theme,
    openPanes: s.openPanes,
    setOpenPanes: s.setOpenPanes,
    onboardingStatus: s.onboardingStatus,
    didDragInStream: s.didDragInStream,
    setDidDragInStream: s.setDidDragInStream,
    setStreamDimensions: s.setStreamDimensions,
    streamDimensions: s.streamDimensions,
  }))
  const [token] = useAuthMachine((s) => s?.context?.token)

  const editorTheme = theme === Themes.System ? getSystemTheme() : theme

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
      : didDragInStream
      ? 'opacity-40'
      : ''

  // Use file code loaded from disk
  // on mount, and overwrite any locally-stored code
  useEffect(() => {
    if (isTauri() && loadedCode !== null) {
      setCode(loadedCode)
    }
    return () => {
      // Clear code on unmount if in desktop app
      if (isTauri()) {
        setCode('')
      }
    }
  }, [loadedCode, setCode])

  // const onChange = React.useCallback((value: string, viewUpdate: ViewUpdate) => {
  const onChange = (value: string, viewUpdate: ViewUpdate) => {
    setCode(value)
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
  const pixelDensity = window.devicePixelRatio
  const streamWidth = streamRef?.current?.offsetWidth
  const streamHeight = streamRef?.current?.offsetHeight

  const width = streamWidth ? streamWidth * pixelDensity : 0
  const quadWidth = Math.round(width / 4) * 4
  const height = streamHeight ? streamHeight * pixelDensity : 0
  const quadHeight = Math.round(height / 4) * 4

  useLayoutEffect(() => {
    setStreamDimensions({
      streamWidth: quadWidth,
      streamHeight: quadHeight,
    })
    if (!width || !height) return
    const eng = new EngineCommandManager({
      setMediaStream,
      setIsStreamReady,
      width: quadWidth,
      height: quadHeight,
      token,
    })
    setEngineCommandManager(eng)
    return () => {
      eng?.tearDown()
    }
  }, [quadWidth, quadHeight])

  useEffect(() => {
    if (!isStreamReady) return
    const asyncWrap = async () => {
      try {
        if (!code) {
          setAst(null)
          return
        }
        const _ast = await asyncParser(code)
        setAst(_ast)
        resetLogs()
        resetKCLErrors()
        if (engineCommandManager) {
          engineCommandManager.endSession()
          engineCommandManager.startNewSession()
        }
        if (!engineCommandManager) return
        const programMemory = await _executor(
          _ast,
          {
            root: {
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
          },
          engineCommandManager
        )

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
        engineCommandManager.onClick((selections) => {
          if (!selections) {
            setCursor2()
            return
          }
          const { id, type } = selections
          setCursor2({ range: sourceRangeMap[id], type })
        })
        if (programMemory !== undefined) {
          setProgramMemory(programMemory)
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
  const handleMouseMove: MouseEventHandler<HTMLDivElement> = ({
    clientX,
    clientY,
    ctrlKey,
    shiftKey,
    currentTarget,
    nativeEvent,
  }) => {
    nativeEvent.preventDefault()
    if (isMouseDownInStream) {
      setDidDragInStream(true)
    }

    const { x, y } = getNormalisedCoordinates({
      clientX,
      clientY,
      el: currentTarget,
      ...streamDimensions,
    })

    const interaction = ctrlKey ? 'zoom' : shiftKey ? 'pan' : 'rotate'

    const newCmdId = uuidv4()
    setCmdId(newCmdId)

    if (cmdId && isMouseDownInStream) {
      debounceSocketSend({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'camera_drag_move',
          interaction,
          window: { x, y },
        },
        cmd_id: newCmdId,
      })
    } else {
      debounceSocketSend({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'highlight_set_entity',
          selected_at_window: { x, y },
        },
        cmd_id: newCmdId,
      })
    }
  }

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
      className="h-screen overflow-hidden relative flex flex-col cursor-pointer select-none"
      onMouseMove={handleMouseMove}
      ref={streamRef}
    >
      <AppHeader
        className={
          'transition-opacity transition-duration-75 ' +
          paneOpacity +
          (isMouseDownInStream ? ' pointer-events-none' : '')
        }
        project={project}
        enableMenu={true}
      />
      <ModalContainer />
      <Resizable
        className={
          'h-full flex flex-col flex-1 z-10 my-5 ml-5 pr-1 transition-opacity transition-duration-75 ' +
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
        <div className="h-full flex flex-col justify-between">
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
                theme={editorTheme}
                onCreateEditor={(_editorView) => setEditorView(_editorView)}
              />
            </div>
          </CollapsiblePanel>
          <section className="flex flex-col">
            <MemoryPanel
              theme={editorTheme}
              open={openPanes.includes('variables')}
              title="Variables"
              icon={faSquareRootVariable}
            />
            <Logs
              theme={editorTheme}
              open={openPanes.includes('logs')}
              title="Logs"
              icon={faCodeCommit}
            />
            <KCLErrors
              theme={editorTheme}
              open={openPanes.includes('kclErrors')}
              title="KCL Errors"
              iconClassNames={{ icon: 'group-open:text-destroy-30' }}
            />
          </section>
        </div>
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
