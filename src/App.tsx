import {
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  MouseEventHandler,
} from 'react'
import { DebugPanel } from './components/DebugPanel'
import { v4 as uuidv4 } from 'uuid'
import { asyncParser } from './lang/abstractSyntaxTree'
import { _executor } from './lang/executor'
import { PaneType, useStore } from './useStore'
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
import { throttle } from './lib/utils'
import { AppHeader } from './components/AppHeader'
import { KCLError } from './lang/errors'
import { Resizable } from 're-resizable'
import {
  faCode,
  faCodeCommit,
  faSquareRootVariable,
} from '@fortawesome/free-solid-svg-icons'
import { useHotkeys } from 'react-hotkeys-hook'
import { getNormalisedCoordinates } from './lib/utils'
import { isTauri } from './lib/isTauri'
import { useLoaderData } from 'react-router-dom'
import { IndexLoaderData } from './Router'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { onboardingPaths } from 'routes/Onboarding'
import { cameraMouseDragGuards } from 'lib/cameraControls'
import { CameraDragInteractionType_type } from '@kittycad/lib/dist/types/src/models'
import { CodeMenu } from 'components/CodeMenu'
import { TextEditor } from 'components/TextEditor'
import { Themes, getSystemTheme } from 'lib/theme'

export function App() {
  const { code: loadedCode, project } = useLoaderData() as IndexLoaderData

  const streamRef = useRef<HTMLDivElement>(null)
  useHotKeyListener()
  const {
    addLog,
    addKCLError,
    setCode,
    setAst,
    setError,
    setProgramMemory,
    resetLogs,
    resetKCLErrors,
    setArtifactMap,
    engineCommandManager,
    setEngineCommandManager,
    highlightRange,
    setHighlightRange,
    setCursor2,
    setMediaStream,
    setIsStreamReady,
    isStreamReady,
    buttonDownInStream,
    openPanes,
    setOpenPanes,
    didDragInStream,
    setStreamDimensions,
    streamDimensions,
    setIsExecuting,
    defferedCode,
    guiMode,
  } = useStore((s) => ({
    guiMode: s.guiMode,
    addLog: s.addLog,
    defferedCode: s.defferedCode,
    setCode: s.setCode,
    setAst: s.setAst,
    setError: s.setError,
    setProgramMemory: s.setProgramMemory,
    resetLogs: s.resetLogs,
    resetKCLErrors: s.resetKCLErrors,
    setArtifactMap: s.setArtifactNSourceRangeMaps,
    engineCommandManager: s.engineCommandManager,
    setEngineCommandManager: s.setEngineCommandManager,
    highlightRange: s.highlightRange,
    setHighlightRange: s.setHighlightRange,
    setCursor2: s.setCursor2,
    setMediaStream: s.setMediaStream,
    isStreamReady: s.isStreamReady,
    setIsStreamReady: s.setIsStreamReady,
    buttonDownInStream: s.buttonDownInStream,
    addKCLError: s.addKCLError,
    openPanes: s.openPanes,
    setOpenPanes: s.setOpenPanes,
    didDragInStream: s.didDragInStream,
    setStreamDimensions: s.setStreamDimensions,
    streamDimensions: s.streamDimensions,
    setIsExecuting: s.setIsExecuting,
  }))

  const {
    auth: {
      context: { token },
    },
    settings: {
      context: { showDebugPanel, onboardingStatus, cameraControls, theme },
    },
  } = useGlobalStateContext()

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
    onboardingStatus === onboardingPaths.CAMERA
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

  const streamWidth = streamRef?.current?.offsetWidth
  const streamHeight = streamRef?.current?.offsetHeight

  const width = streamWidth ? streamWidth : 0
  const quadWidth = Math.round(width / 4) * 4
  const height = streamHeight ? streamHeight : 0
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
    if (!engineCommandManager) return
    let unsubFn: any[] = []
    const asyncWrap = async () => {
      try {
        if (!defferedCode) {
          setAst({
            start: 0,
            end: 0,
            body: [],
            nonCodeMeta: {
              noneCodeNodes: {},
              start: null,
            },
          })
          setProgramMemory({ root: {}, return: null })
          engineCommandManager.endSession()
          engineCommandManager.startNewSession()
          return
        }
        const _ast = await asyncParser(defferedCode)
        setAst(_ast)
        resetLogs()
        resetKCLErrors()
        engineCommandManager.endSession()
        engineCommandManager.startNewSession()
        setIsExecuting(true)
        const programMemory = await _executor(
          _ast,
          {
            root: {
              _0: {
                type: 'UserVal',
                value: 0,
                __meta: [],
              },
              _90: {
                type: 'UserVal',
                value: 90,
                __meta: [],
              },
              _180: {
                type: 'UserVal',
                value: 180,
                __meta: [],
              },
              _270: {
                type: 'UserVal',
                value: 270,
                __meta: [],
              },
            },
            return: null,
          },
          engineCommandManager
        )

        const { artifactMap, sourceRangeMap } =
          await engineCommandManager.waitForAllCommands()
        setIsExecuting(false)
        if (programMemory !== undefined) {
          setProgramMemory(programMemory)
        }

        setArtifactMap({ artifactMap, sourceRangeMap })
        const unSubHover = engineCommandManager.subscribeToUnreliable({
          event: 'highlight_set_entity',
          callback: ({ data }) => {
            if (data?.entity_id) {
              const sourceRange = sourceRangeMap[data.entity_id]
              setHighlightRange(sourceRange)
            } else if (
              !highlightRange ||
              (highlightRange[0] !== 0 && highlightRange[1] !== 0)
            ) {
              setHighlightRange([0, 0])
            }
          },
        })
        const unSubClick = engineCommandManager.subscribeTo({
          event: 'select_with_point',
          callback: ({ data }) => {
            if (!data?.entity_id) {
              setCursor2()
              return
            }
            const sourceRange = sourceRangeMap[data.entity_id]
            setCursor2({ range: sourceRange, type: 'default' })
          },
        })
        unsubFn.push(unSubHover, unSubClick)

        setError()
      } catch (e: any) {
        setIsExecuting(false)
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
    return () => {
      unsubFn.forEach((fn) => fn())
    }
  }, [defferedCode, isStreamReady, engineCommandManager])

  const debounceSocketSend = throttle<EngineCommand>((message) => {
    engineCommandManager?.sendSceneCommand(message)
  }, 16)
  const handleMouseMove: MouseEventHandler<HTMLDivElement> = (e) => {
    e.nativeEvent.preventDefault()

    const { x, y } = getNormalisedCoordinates({
      clientX: e.clientX,
      clientY: e.clientY,
      el: e.currentTarget,
      ...streamDimensions,
    })

    const newCmdId = uuidv4()
    if (buttonDownInStream === undefined) {
      if (
        guiMode.mode === 'sketch' &&
        guiMode.sketchMode === ('sketch_line' as any)
      ) {
        debounceSocketSend({
          type: 'modeling_cmd_req',
          cmd_id: newCmdId,
          cmd: {
            type: 'mouse_move',
            window: { x, y },
          },
        })
      } else if (
        guiMode.mode === 'sketch' &&
        guiMode.sketchMode === ('move' as any)
      ) {
        debounceSocketSend({
          type: 'modeling_cmd_req',
          cmd_id: newCmdId,
          cmd: {
            type: 'handle_mouse_drag_move',
            window: { x, y },
          },
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
    } else {
      const interactionGuards = cameraMouseDragGuards[cameraControls]
      let interaction: CameraDragInteractionType_type

      const eWithButton = { ...e, button: buttonDownInStream }

      if (interactionGuards.pan.callback(eWithButton)) {
        interaction = 'pan'
      } else if (interactionGuards.rotate.callback(eWithButton)) {
        interaction = 'rotate'
      } else if (interactionGuards.zoom.dragCallback(eWithButton)) {
        interaction = 'zoom'
      } else {
        console.log('none')
        return
      }

      debounceSocketSend({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'camera_drag_move',
          interaction,
          window: { x, y },
        },
        cmd_id: newCmdId,
      })
    }
  }

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
          (buttonDownInStream ? ' pointer-events-none' : '')
        }
        project={project}
        enableMenu={true}
      />
      <ModalContainer />
      <Resizable
        className={
          'h-full flex flex-col flex-1 z-10 my-5 ml-5 pr-1 transition-opacity transition-duration-75 ' +
          (buttonDownInStream || onboardingStatus === 'camera'
            ? ' pointer-events-none '
            : ' ') +
          paneOpacity
        }
        defaultSize={{
          width: '550px',
          height: 'auto',
        }}
        minWidth={200}
        maxWidth={800}
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
            menu={<CodeMenu />}
          >
            <TextEditor theme={editorTheme} />
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
      {showDebugPanel && (
        <DebugPanel
          title="Debug"
          className={
            'transition-opacity transition-duration-75 ' +
            paneOpacity +
            (buttonDownInStream ? ' pointer-events-none' : '')
          }
          open={openPanes.includes('debug')}
        />
      )}
    </div>
  )
}
