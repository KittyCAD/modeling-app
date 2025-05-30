import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useHotkeys } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'

import { AppHeader } from '@src/components/AppHeader'
import { EngineStream } from '@src/components/EngineStream'
import Gizmo from '@src/components/Gizmo'
import { LowerRightControls } from '@src/components/LowerRightControls'
import { useLspContext } from '@src/components/LspProvider'
import { ModelingSidebar } from '@src/components/ModelingSidebar/ModelingSidebar'
import { UnitsMenu } from '@src/components/UnitsMenu'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useQueryParamEffects } from '@src/hooks/useQueryParamEffects'
import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'
import { useHotKeyListener } from '@src/hooks/useHotKeyListener'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import {
  billingActor,
  sceneInfra,
  codeManager,
  kclManager,
  settingsActor,
} from '@src/lib/singletons'
import { maybeWriteToDisk } from '@src/lib/telemetry'
import type { IndexLoaderData } from '@src/lib/types'
import { engineStreamActor, useSettings, useToken } from '@src/lib/singletons'
import { EngineStreamTransition } from '@src/machines/engineStreamMachine'
import { BillingTransition } from '@src/machines/billingMachine'
import { CommandBarOpenButton } from '@src/components/CommandBarOpenButton'
import { ShareButton } from '@src/components/ShareButton'
import {
  needsToOnboard,
  TutorialRequestToast,
} from '@src/routes/Onboarding/utils'
import { reportRejection } from '@src/lib/trap'
import { DownloadAppToast } from '@src/components/DownloadAppToast'
import { WasmErrToast } from '@src/components/WasmErrToast'
import openWindow from '@src/lib/openWindow'
import {
  APP_DOWNLOAD_PATH,
  DOWNLOAD_APP_TOAST_ID,
  ONBOARDING_TOAST_ID,
  WASM_INIT_FAILED_TOAST_ID,
} from '@src/lib/constants'
import { isPlaywright } from '@src/lib/isPlaywright'
import { VITE_KC_SITE_BASE_URL } from '@src/env'
import { _3DMouse } from "@src/lib/externalMouse/external-mouse"

// CYCLIC REF
sceneInfra.camControls.engineStreamActor = engineStreamActor

maybeWriteToDisk()
  .then(() => {})
  .catch(() => {})


let once = false

export function App() {
  if (!once) {
    const the3DMouse = new _3DMouse({
      // Name needs to be registered in the python proxy server!
      name: 'zoo-design-studio',
      debug: false,
      canvasId: 'webgl',
    })

    window.the3DMouse = the3DMouse
    the3DMouse.init3DMouse()
    once = true
  }
  useQueryParamEffects()
  const { project, file } = useLoaderData() as IndexLoaderData
  const [nativeFileMenuCreated, setNativeFileMenuCreated] = useState(false)

  const location = useLocation()
  const navigate = useNavigate()
  const filePath = useAbsoluteFilePath()
  const { onProjectOpen } = useLspContext()
  // We need the ref for the outermost div so we can screenshot the app for
  // the coredump.
  const ref = useRef<HTMLDivElement>(null)

  // Stream related refs and data
  const [searchParams] = useSearchParams()
  const pool = searchParams.get('pool')

  const projectName = project?.name || null
  const projectPath = project?.path || null

  // Run LSP file open hook when navigating between projects or files
  useEffect(() => {
    onProjectOpen({ name: projectName, path: projectPath }, file || null)
  }, [onProjectOpen, projectName, projectPath, file])

  useHotKeyListener()

  const settings = useSettings()
  const authToken = useToken()

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

  useEngineConnectionSubscriptions()

  useEffect(() => {
    // Not too useful for regular flows but on modeling view refresh,
    // fetch the token count. The regular flow is the count is initialized
    // by the Projects view.
    billingActor.send({ type: BillingTransition.Update, apiToken: authToken })

    // When leaving the modeling scene, cut the engine stream.
    return () => {
      // When leaving the modeling scene, cut the engine stream.
      // Stop is more serious than Pause
      engineStreamActor.send({ type: EngineStreamTransition.Stop })
    }
  }, [])

  // Show a custom toast to users if they haven't done the onboarding
  // and they're on the web
  useEffect(() => {
    const onboardingStatus =
      settings.app.onboardingStatus.current ||
      settings.app.onboardingStatus.default
    const needsOnboarded =
      !isDesktop() &&
      searchParams.size === 0 &&
      needsToOnboard(location, onboardingStatus)

    if (needsOnboarded) {
      toast.success(
        () =>
          TutorialRequestToast({
            onboardingStatus: settings.app.onboardingStatus.current,
            navigate,
            codeManager,
            kclManager,
          }),
        {
          id: ONBOARDING_TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
          icon: null,
        }
      )
    }
  }, [settings.app.onboardingStatus])

  useEffect(() => {
    const needsDownloadAppToast =
      !isDesktop() &&
      !isPlaywright() &&
      searchParams.size === 0 &&
      !settings.app.dismissWebBanner.current
    if (needsDownloadAppToast) {
      toast.success(
        () =>
          DownloadAppToast({
            onAccept: () => {
              openWindow(`${VITE_KC_SITE_BASE_URL}/${APP_DOWNLOAD_PATH}`)
                .then(() => {
                  toast.dismiss(DOWNLOAD_APP_TOAST_ID)
                })
                .catch(reportRejection)
            },
            onDismiss: () => {
              toast.dismiss(DOWNLOAD_APP_TOAST_ID)
              settingsActor.send({
                type: 'set.app.dismissWebBanner',
                data: { level: 'user', value: true },
              })
            },
          }),
        {
          id: DOWNLOAD_APP_TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
          icon: null,
        }
      )
    }
  }, [])

  useEffect(() => {
    const needsWasmInitFailedToast = !isDesktop() && kclManager.wasmInitFailed
    if (needsWasmInitFailedToast) {
      toast.success(
        () =>
          WasmErrToast({
            onDismiss: () => {
              toast.dismiss(WASM_INIT_FAILED_TOAST_ID)
            },
          }),
        {
          id: WASM_INIT_FAILED_TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
          icon: null,
        }
      )
    }
  }, [kclManager.wasmInitFailed])

  // Only create the native file menus on desktop
  useEffect(() => {
    if (isDesktop()) {
      window.electron
        .createModelingPageMenu()
        .then(() => {
          setNativeFileMenuCreated(true)
        })
        .catch(reportRejection)
    }
  }, [])

  return (
    <div className="relative h-full flex flex-col" ref={ref}>
      <AppHeader
        className="transition-opacity transition-duration-75"
        project={{ project, file }}
        enableMenu={true}
        nativeFileMenuCreated={nativeFileMenuCreated}
      >
        <CommandBarOpenButton />
        <ShareButton />
      </AppHeader>
      <ModalContainer />
      <ModelingSidebar />
      <EngineStream pool={pool} authToken={authToken} />
      {/* <CamToggle /> */}
      <LowerRightControls navigate={navigate}>
        <UnitsMenu />
        <Gizmo />
      </LowerRightControls>
    </div>
  )
}
