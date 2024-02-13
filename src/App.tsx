import { useCallback, MouseEventHandler } from 'react'
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
import { useLoaderData, useNavigate } from 'react-router-dom'
import { type IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { CodeMenu } from 'components/CodeMenu'
import { TextEditor } from 'components/TextEditor'
import { Themes, getSystemTheme } from 'lib/theme'
import { useEngineConnectionSubscriptions } from 'hooks/useEngineConnectionSubscriptions'
import { engineCommandManager } from './lang/std/engineConnection'
import { useModelingContext } from 'hooks/useModelingContext'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { isTauri } from 'lib/isTauri'

export function App() {
  const { project, file } = useLoaderData() as IndexLoaderData
  const navigate = useNavigate()
  const filePath = useAbsoluteFilePath()

  useHotKeyListener()
  const {
    buttonDownInStream,
    openPanes,
    setOpenPanes,
    didDragInStream,
    streamDimensions,
  } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
    openPanes: s.openPanes,
    setOpenPanes: s.setOpenPanes,
    didDragInStream: s.didDragInStream,
    streamDimensions: s.streamDimensions,
  }))

  const { settings } = useGlobalStateContext()
  const { showDebugPanel, onboardingStatus, theme } = settings?.context || {}
  const { state, send } = useModelingContext()

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
  useHotkeys('esc', () => send('Cancel'))
  useHotkeys(
    isTauri() ? 'mod + ,' : 'shift + mod + ,',
    () => navigate(filePath + paths.SETTINGS),
    {
      splitKey: '|',
    }
  )

  const paneOpacity = [onboardingPaths.CAMERA, onboardingPaths.STREAMING].some(
    (p) => p === onboardingStatus
  )
    ? 'opacity-20'
    : didDragInStream
    ? 'opacity-40'
    : ''

  useEngineConnectionSubscriptions()

  const debounceSocketSend = throttle<EngineCommand>((message) => {
    engineCommandManager.sendSceneCommand(message)
  }, 1000 / 15)
  const handleMouseMove: MouseEventHandler<HTMLDivElement> = (e) => {
    if (state.matches('Sketch')) {
      return
    }

    const { x, y } = getNormalisedCoordinates({
      clientX: e.clientX,
      clientY: e.clientY,
      el: e.currentTarget,
      ...streamDimensions,
    })

    const newCmdId = uuidv4()
    if (buttonDownInStream === undefined) {
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
        project={{ project, file }}
        enableMenu={true}
      />
      <ModalContainer />
      <Resizable
        className={
          'pointer-events-none h-full flex flex-col flex-1 z-10 my-5 ml-5 pr-1 transition-opacity transition-duration-75 ' +
          +paneOpacity
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
            'hover:bg-chalkboard-10/50 bg-transparent transition-colors duration-75 transition-ease-out delay-100 ' +
            (buttonDownInStream || onboardingStatus === 'camera'
              ? 'pointer-events-none '
              : 'pointer-events-auto'),
        }}
      >
        <div
          id="code-pane"
          className="h-full flex flex-col justify-between pointer-events-none"
        >
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
      {/* <CamToggle /> */}
    </div>
  )
}
