import { useEffect, useCallback, MouseEventHandler } from 'react'
import { DebugPanel } from './components/DebugPanel'
import { v4 as uuidv4 } from 'uuid'
import { PaneType, useStore } from './useStore'
import { Logs, KCLErrors } from './components/Logs'
import { CollapsiblePanel } from './components/CollapsiblePanel'
import { MemoryPanel } from './components/MemoryPanel'
import { useHotKeyListener } from './hooks/useHotKeyListener'
import { Stream } from './components/Stream'
import ModalContainer from 'react-modal-promise'
import { EngineCommand } from './lang/std/engineConnection'
import { throttle } from './lib/utils'
import { AppHeader } from './components/AppHeader'
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
import { useEngineConnectionSubscriptions } from 'hooks/useEngineConnectionSubscriptions'
import { engineCommandManager } from './lang/std/engineConnection'
import { kclManager } from 'lang/KclSinglton'
import { useModelingContext } from 'hooks/useModelingContext'

export function App() {
  const { code: loadedCode, project } = useLoaderData() as IndexLoaderData

  useHotKeyListener()
  const {
    buttonDownInStream,
    openPanes,
    setOpenPanes,
    didDragInStream,
    streamDimensions,
    guiMode,
    setGuiMode,
  } = useStore((s) => ({
    guiMode: s.guiMode,
    setGuiMode: s.setGuiMode,
    buttonDownInStream: s.buttonDownInStream,
    openPanes: s.openPanes,
    setOpenPanes: s.setOpenPanes,
    didDragInStream: s.didDragInStream,
    streamDimensions: s.streamDimensions,
  }))

  const { settings } = useGlobalStateContext()
  const { showDebugPanel, onboardingStatus, cameraControls, theme } =
    settings?.context || {}
  const { state } = useModelingContext()

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
  useHotkeys('esc', () => {
    if (guiMode.mode === 'sketch') {
      if (guiMode.sketchMode === 'selectFace') return
      if (guiMode.sketchMode === 'sketchEdit') {
        // TODO: share this with Toolbar's "Exit sketch" button
        // exiting sketch should be done consistently across all exits
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'edit_mode_exit' },
        })
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'default_camera_disable_sketch_mode' },
        })
        setGuiMode({ mode: 'default' })
        // this is necessary to get the UI back into a consistent
        // state right now, hopefully won't need to rerender
        // when exiting sketch mode in the future
        kclManager.executeAst()
      } else {
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'select',
          },
        })
        setGuiMode({
          mode: 'sketch',
          sketchMode: 'sketchEdit',
          rotation: guiMode.rotation,
          position: guiMode.position,
          pathToNode: guiMode.pathToNode,
          pathId: guiMode.pathId,
          // todo: ...guiMod is adding isTooltip: true, will probably just fix with xstate migtaion
        })
      }
    } else {
      setGuiMode({ mode: 'default' })
    }
  })

  const paneOpacity = [onboardingPaths.CAMERA, onboardingPaths.STREAMING].some(
    (p) => p === onboardingStatus
  )
    ? 'opacity-20'
    : didDragInStream
    ? 'opacity-40'
    : ''

  // Use file code loaded from disk
  // on mount, and overwrite any locally-stored code
  useEffect(() => {
    if (isTauri() && loadedCode !== null) {
      kclManager.setCode(loadedCode)
    }
    return () => {
      // Clear code on unmount if in desktop app
      if (isTauri()) {
        kclManager.setCode('')
      }
    }
  }, [loadedCode, kclManager.setCode])

  useEngineConnectionSubscriptions()

  const debounceSocketSend = throttle<EngineCommand>((message) => {
    engineCommandManager.sendSceneCommand(message)
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
      if (state.matches('Sketch.Line Tool')) {
        debounceSocketSend({
          type: 'modeling_cmd_req',
          cmd_id: newCmdId,
          cmd: {
            type: 'mouse_move',
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
      if (state.matches('Sketch.Move Tool')) {
        debounceSocketSend({
          type: 'modeling_cmd_req',
          cmd_id: newCmdId,
          cmd: {
            type: 'handle_mouse_drag_move',
            window: { x, y },
          },
        })
        return
      }
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
      className="relative h-full flex flex-col"
      onMouseMove={handleMouseMove}
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
        <div id="code-pane" className="h-full flex flex-col justify-between">
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
