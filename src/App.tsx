import { MouseEventHandler, useEffect, useMemo, useRef } from 'react'
import { uuidv4 } from 'lib/utils'
import { useHotKeyListener } from './hooks/useHotKeyListener'
import { Stream } from './components/Stream'
import { EngineCommand } from 'lang/std/artifactGraph'
import { throttle } from './lib/utils'
import { AppHeader } from './components/AppHeader'
import { useHotkeys } from 'react-hotkeys-hook'
import { getNormalisedCoordinates } from './lib/utils'
import { useLoaderData, useNavigate } from 'react-router-dom'
import { type IndexLoaderData } from 'lib/types'
import { PATHS } from 'lib/paths'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useEngineConnectionSubscriptions } from 'hooks/useEngineConnectionSubscriptions'
import { codeManager, engineCommandManager } from 'lib/singletons'
import { useModelingContext } from 'hooks/useModelingContext'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { isDesktop } from 'lib/isDesktop'
import { useLspContext } from 'components/LspProvider'
import { useRefreshSettings } from 'hooks/useRefreshSettings'
import { ModelingSidebar } from 'components/ModelingSidebar/ModelingSidebar'
import { LowerRightControls } from 'components/LowerRightControls'
import ModalContainer from 'react-modal-promise'
import useHotkeyWrapper from 'lib/hotkeyWrapper'
import Gizmo from 'components/Gizmo'
import { CoreDumpManager } from 'lib/coredump'
import { UnitsMenu } from 'components/UnitsMenu'
import { reportRejection } from 'lib/trap'

export function App() {
  const { project, file } = useLoaderData() as IndexLoaderData
  useRefreshSettings(PATHS.FILE + 'SETTINGS')
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
  const { context, state } = useModelingContext()

  const { auth, settings } = useSettingsAuthContext()
  const token = auth?.context?.token

  const coreDumpManager = useMemo(
    () => new CoreDumpManager(engineCommandManager, codeManager, token),
    []
  )

  const {
    app: { onboardingStatus },
  } = settings.context

  useHotkeys('backspace', (e) => {
    e.preventDefault()
  })
  useHotkeyWrapper(
    [isDesktop() ? 'mod + ,' : 'shift + mod + ,'],
    () => navigate(filePath + PATHS.SETTINGS),
    {
      splitKey: '|',
    }
  )

  const paneOpacity = [onboardingPaths.CAMERA, onboardingPaths.STREAMING].some(
    (p) => p === onboardingStatus.current
  )
    ? 'opacity-20'
    : ''

  useEngineConnectionSubscriptions()

  const debounceSocketSend = throttle<EngineCommand>((message) => {
    engineCommandManager.sendSceneCommand(message).catch(reportRejection)
  }, 1000 / 15)
  const handleMouseMove: MouseEventHandler<HTMLDivElement> = (e) => {
    if (state.matches('Sketch')) {
      return
    }

    const { x, y } = getNormalisedCoordinates({
      clientX: e.clientX,
      clientY: e.clientY,
      el: e.currentTarget,
      ...context.store?.streamDimensions,
    })

    const newCmdId = uuidv4()
    if (state.matches({ idle: 'showPlanes' })) return
    if (context.store?.buttonDownInStream !== undefined) return
    debounceSocketSend({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'highlight_set_entity',
        selected_at_window: { x, y },
      },
      cmd_id: newCmdId,
    })
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
          (context.store?.buttonDownInStream ? ' pointer-events-none' : '')
        }
        // Override the electron window draggable region behavior as well
        // when the button is down in the stream
        style={
          isDesktop() && context.store?.buttonDownInStream
            ? ({
                '-webkit-app-region': 'no-drag',
              } as React.CSSProperties)
            : {}
        }
        project={{ project, file }}
        enableMenu={true}
      />
      <ModalContainer />
      <ModelingSidebar paneOpacity={paneOpacity} />
      <Stream />
      {/* <CamToggle /> */}
      <LowerRightControls coreDumpManager={coreDumpManager}>
        <UnitsMenu />
        <Gizmo />
      </LowerRightControls>
    </div>
  )
}
