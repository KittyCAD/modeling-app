import { CameraProjectionToggle } from 'components/CameraProjectionToggle'
import { useEngineCommands } from 'components/EngineCommands'
import Gizmo from 'components/Gizmo'
import { LowerRightControls } from 'components/LowerRightControls'
import { useLspContext } from 'components/LspProvider'
import { ModelingSidebar } from 'components/ModelingSidebar/ModelingSidebar'
import { UnitsMenu } from 'components/UnitsMenu'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { useCreateFileLinkQuery } from 'hooks/useCreateFileLinkQueryWatcher'
import { useEngineConnectionSubscriptions } from 'hooks/useEngineConnectionSubscriptions'
import { CoreDumpManager } from 'lib/coredump'
import { writeProjectThumbnailFile } from 'lib/desktop'
import useHotkeyWrapper from 'lib/hotkeyWrapper'
import { isDesktop } from 'lib/isDesktop'
import { PATHS } from 'lib/paths'
import { takeScreenshotOfVideoStreamCanvas } from 'lib/screenshot'
import { codeManager, engineCommandManager } from 'lib/singletons'
import { rustContext } from 'lib/singletons'
import { maybeWriteToDisk } from 'lib/telemetry'
import { type IndexLoaderData } from 'lib/types'
import { useToken } from 'machines/appMachine'
import { useSettings } from 'machines/appMachine'
import { commandBarActor } from 'machines/commandBarMachine'
import { useEffect, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import { useHotkeys } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import { useLoaderData, useNavigate } from 'react-router-dom'
import { useRouteLoaderData } from 'react-router-dom'
import { onboardingPaths } from 'routes/Onboarding/paths'

import { AppHeader } from './components/AppHeader'
import { Stream } from './components/Stream'
import { useHotKeyListener } from './hooks/useHotKeyListener'

maybeWriteToDisk()
  .then(() => {})
  .catch(() => {})

export function App() {
  const { project, file } = useLoaderData() as IndexLoaderData

  // Keep a lookout for a URL query string that invokes the 'import file from URL' command
  useCreateFileLinkQuery((argDefaultValues) => {
    commandBarActor.send({
      type: 'Find and select command',
      data: {
        groupId: 'projects',
        name: 'Import file from URL',
        argDefaultValues,
      },
    })
  })

  const navigate = useNavigate()
  const filePath = useAbsoluteFilePath()
  const { onProjectOpen } = useLspContext()
  // We need the ref for the outermost div so we can screenshot the app for
  // the coredump.
  const ref = useRef<HTMLDivElement>(null)

  const projectName = project?.name || null
  const projectPath = project?.path || null

  const [commands] = useEngineCommands()
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const lastCommandType = commands[commands.length - 1]?.type

  useEffect(() => {
    onProjectOpen({ name: projectName, path: projectPath }, file || null)
  }, [projectName, projectPath])

  useHotKeyListener()

  const settings = useSettings()
  const token = useToken()

  const coreDumpManager = useMemo(
    () =>
      new CoreDumpManager(
        engineCommandManager,
        codeManager,
        rustContext,
        token
      ),
    []
  )

  const {
    app: { onboardingStatus },
  } = settings

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

  useHotkeyWrapper(['mod + s'], () => {
    toast.success('Your work is auto-saved in real-time')
  })

  const paneOpacity = [onboardingPaths.CAMERA, onboardingPaths.STREAMING].some(
    (p) => p === onboardingStatus.current
  )
    ? 'opacity-20'
    : ''

  useEngineConnectionSubscriptions()

  // Generate thumbnail.png when loading the app
  useEffect(() => {
    if (isDesktop() && lastCommandType === 'execution-done') {
      setTimeout(() => {
        const projectDirectoryWithoutEndingSlash = loaderData?.project?.path
        if (!projectDirectoryWithoutEndingSlash) {
          return
        }
        const dataUrl: string = takeScreenshotOfVideoStreamCanvas()
        // zoom to fit command does not wait, wait 500ms to see if zoom to fit finishes
        writeProjectThumbnailFile(dataUrl, projectDirectoryWithoutEndingSlash)
          .then(() => {})
          .catch((e) => {
            console.error(
              `Failed to generate thumbnail for ${projectDirectoryWithoutEndingSlash}`
            )
            console.error(e)
          })
      }, 500)
    }
  }, [lastCommandType])

  return (
    <div className="relative h-full flex flex-col" ref={ref}>
      <AppHeader
        className={'transition-opacity transition-duration-75 ' + paneOpacity}
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
        <CameraProjectionToggle />
      </LowerRightControls>
    </div>
  )
}
