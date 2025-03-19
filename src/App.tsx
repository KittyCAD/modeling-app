import { useEffect, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import { useHotkeys } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import {
  useLoaderData,
  useNavigate,
  useRouteLoaderData,
} from 'react-router-dom'

import { AppHeader } from '@src/components/AppHeader'
import { CameraProjectionToggle } from '@src/components/CameraProjectionToggle'
import { useEngineCommands } from '@src/components/EngineCommands'
import Gizmo from '@src/components/Gizmo'
import { LowerRightControls } from '@src/components/LowerRightControls'
import { useLspContext } from '@src/components/LspProvider'
import { ModelingSidebar } from '@src/components/ModelingSidebar/ModelingSidebar'
import { Stream } from '@src/components/Stream'
import { UnitsMenu } from '@src/components/UnitsMenu'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useCreateFileLinkQuery } from '@src/hooks/useCreateFileLinkQueryWatcher'
import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'
import { useHotKeyListener } from '@src/hooks/useHotKeyListener'
import { CoreDumpManager } from '@src/lib/coredump'
import { writeProjectThumbnailFile } from '@src/lib/desktop'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { takeScreenshotOfVideoStreamCanvas } from '@src/lib/screenshot'
import {
  codeManager,
  engineCommandManager,
  rustContext,
} from '@src/lib/singletons'
import { maybeWriteToDisk } from '@src/lib/telemetry'
import { type IndexLoaderData } from '@src/lib/types'
import { useSettings, useToken } from '@src/machines/appMachine'
import { commandBarActor } from '@src/machines/commandBarMachine'
import { onboardingPaths } from '@src/routes/Onboarding/paths'

maybeWriteToDisk()
  .then(() => {})
  .catch(() => {})
import { EngineStream } from 'components/EngineStream'

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

  // Stream related refs and data
  let [searchParams] = useSearchParams()
  const pool = searchParams.get('pool')

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
  const authToken = useToken()

  const coreDumpManager = useMemo(
    () =>
      new CoreDumpManager(
        engineCommandManager,
        codeManager,
        rustContext,
        authToken
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
      <EngineStream pool={pool} authToken={authToken} />
      {/* <CamToggle /> */}
      <LowerRightControls coreDumpManager={coreDumpManager}>
        <UnitsMenu />
        <Gizmo />
        <CameraProjectionToggle />
      </LowerRightControls>
    </div>
  )
}
