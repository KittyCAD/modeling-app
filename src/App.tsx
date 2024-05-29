import { MouseEventHandler, useEffect, useRef } from 'react'
import { uuidv4 } from 'lib/utils'
import { useStore } from './useStore'
import { useHotKeyListener } from './hooks/useHotKeyListener'
import { Stream } from './components/Stream'
import { EngineCommand } from './lang/std/engineConnection'
import { throttle } from './lib/utils'
import { AppHeader } from './components/AppHeader'
import { useHotkeys } from 'react-hotkeys-hook'
import { getNormalisedCoordinates } from './lib/utils'
import { useLoaderData, useNavigate } from 'react-router-dom'
import { type IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useEngineConnectionSubscriptions } from 'hooks/useEngineConnectionSubscriptions'
import { engineCommandManager } from 'lib/singletons'
import { useModelingContext } from 'hooks/useModelingContext'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { isTauri } from 'lib/isTauri'
import { useLspContext } from 'components/LspProvider'
import { useRefreshSettings } from 'hooks/useRefreshSettings'
import { ModelingSidebar } from 'components/ModelingSidebar/ModelingSidebar'
import { LowerRightControls } from 'components/LowerRightControls'
import ModalContainer from 'react-modal-promise'
import useHotkeyWrapper from 'lib/hotkeyWrapper'
import Gizmo from 'components/Gizmo'

export function App() {
  /**
   * Zoo is a top level container for app structures
   * - It intentionally breaks nameing convention since it is not a class.
   * - Maybe, "ZOO" would be better, but it doesn't look as nice.
   */
  const Zoo = { state: {} }
  if (typeof window !== 'undefined') {
    (window as any).Zoo = Zoo
  }
  
  useRefreshSettings(paths.FILE + 'SETTINGS')
  const { project, file } = useLoaderData() as IndexLoaderData
  const navigate = useNavigate()
  const filePath = useAbsoluteFilePath()
  const { onProjectOpen } = useLspContext()
  // We need the ref for the outermost div so we can screenshot the app for
  // the coredump.
  const ref = useRef<HTMLDivElement>(null)

  const projectName = project?.name || null
  const projectPath = project?.path || null
  useEffect(() => {
    onProjectOpen({ name: projectName, path: projectPath }, file || null)
  }, [projectName, projectPath])

  useHotKeyListener()
  const { buttonDownInStream, didDragInStream, streamDimensions, setHtmlRef } =
    useStore((s) => ({
      buttonDownInStream: s.buttonDownInStream,
      didDragInStream: s.didDragInStream,
      streamDimensions: s.streamDimensions,
      setHtmlRef: s.setHtmlRef,
    }))

  useEffect(() => {
    setHtmlRef(ref)
  }, [ref])

  const { settings } = useSettingsAuthContext()
  const {
    app: { onboardingStatus },
  } = settings.context
  const { state } = useModelingContext()

  useHotkeys('backspace', (e) => {
    e.preventDefault()
  })
  useHotkeyWrapper(
    [isTauri() ? 'mod + ,' : 'shift + mod + ,'],
    () => navigate(filePath + paths.SETTINGS),
    {
      splitKey: '|',
    }
  )

  const paneOpacity = [onboardingPaths.CAMERA, onboardingPaths.STREAMING].some(
    (p) => p === onboardingStatus.current
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
      ref={ref}
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
      <ModelingSidebar paneOpacity={paneOpacity} />
      <Stream className="absolute inset-0 z-0" />
      {/* <CamToggle /> */}
      <LowerRightControls>
        <Gizmo />
      </LowerRightControls>
    </div>
  )
}
