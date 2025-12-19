import { useEffect, useMemo, useState } from 'react'
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
import { CommandBarOpenButton } from '@src/components/CommandBarOpenButton'
import { useLspContext } from '@src/components/LspProvider'
import { useNetworkHealthStatus } from '@src/components/NetworkHealthIndicator'
import { useNetworkMachineStatus } from '@src/components/NetworkMachineIndicator'
import { ShareButton } from '@src/components/ShareButton'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
import {
  defaultGlobalStatusBarItems,
  defaultLocalStatusBarItems,
} from '@src/components/StatusBar/defaultStatusBarItems'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import { UndoRedoButtons } from '@src/components/UndoRedoButtons'
import { WasmErrToast } from '@src/components/WasmErrToast'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'
import { useHotKeyListener } from '@src/hooks/useHotKeyListener'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useQueryParamEffects } from '@src/hooks/useQueryParamEffects'
import {
  DEFAULT_EXPERIMENTAL_FEATURES,
  ONBOARDING_TOAST_ID,
  WASM_INIT_FAILED_TOAST_ID,
} from '@src/lib/constants'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { getSelectionTypeDisplayText } from '@src/lib/selections'
import {
  billingActor,
  getSettings,
  kclManager,
  useLayout,
  setLayout,
  getLayout,
} from '@src/lib/singletons'
import { useSettings, useToken } from '@src/lib/singletons'
import { maybeWriteToDisk } from '@src/lib/telemetry'
import { reportRejection } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { xStateValueToString } from '@src/lib/xStateValueToString'
import { BillingTransition } from '@src/machines/billingMachine'
import {
  TutorialRequestToast,
  needsToOnboard,
} from '@src/routes/Onboarding/utils'
import {
  defaultLayout,
  DefaultLayoutPaneID,
  getOpenPanes,
  LayoutRootNode,
} from '@src/lib/layout'
import { defaultAreaLibrary } from '@src/lib/layout/defaultAreaLibrary'
import { defaultActionLibrary } from '@src/lib/layout/defaultActionLibrary'
import { getResolvedTheme } from '@src/lib/theme'
import {
  MlEphantManagerReactContext,
  MlEphantManagerTransitions,
} from '@src/machines/mlEphantManagerMachine'
import { useSignalEffect } from '@preact/signals-react'
import { UnitsMenu } from '@src/components/UnitsMenu'
import { ExperimentalFeaturesMenu } from '@src/components/ExperimentalFeaturesMenu'
import { ZookeeperCreditsMenu } from '@src/components/ZookeeperCreditsMenu'

if (window.electron) {
  maybeWriteToDisk(window.electron)
    .then(() => {})
    .catch(reportRejection)
}

export function App() {
  const { state: modelingState } = useModelingContext()
  useQueryParamEffects(kclManager)
  const loaderData = useLoaderData() as IndexLoaderData
  const [nativeFileMenuCreated, setNativeFileMenuCreated] = useState(false)
  const mlEphantManagerActor2 = MlEphantManagerReactContext.useActorRef()

  const location = useLocation()
  const navigate = useNavigate()
  const filePath = useAbsoluteFilePath()
  const { onProjectOpen } = useLspContext()
  const networkHealthStatus = useNetworkHealthStatus()
  const networkMachineStatus = useNetworkMachineStatus()

  // We need the ref for the outermost div so we can screenshot the app for
  // the coredump.

  // Stream related refs and data
  const [searchParams] = useSearchParams()

  const projectName = loaderData.project?.name || null
  const projectPath = loaderData.project?.path || null

  // Run LSP file open hook when navigating between projects or files
  useEffect(() => {
    onProjectOpen(
      { name: projectName, path: projectPath },
      loaderData.file || null
    )
  }, [onProjectOpen, projectName, projectPath, loaderData.file])

  useEffect(() => {
    // Clear conversation
    mlEphantManagerActor2.send({
      type: MlEphantManagerTransitions.ConversationClose,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [projectName, projectPath])

  useHotKeyListener(kclManager)

  const settings = useSettings()
  const authToken = useToken()
  const layout = useLayout()

  useHotkeys('backspace', (e) => {
    e.preventDefault()
  })
  // Since these already exist in the editor, we don't need to define them
  // with the wrapper.
  useHotkeys('mod+z', (e) => {
    e.preventDefault()
    kclManager.undo()
  })
  useHotkeys('mod+shift+z', (e) => {
    e.preventDefault()
    kclManager.redo()
  })
  useHotkeyWrapper(
    [isDesktop() ? 'mod + ,' : 'shift + mod + ,'],
    () => navigate(filePath + PATHS.SETTINGS),
    kclManager,
    {
      splitKey: '|',
    }
  )

  useHotkeyWrapper(
    ['mod + s'],
    () => {
      toast.success('Your work is auto-saved in real-time')
    },
    kclManager
  )

  useEngineConnectionSubscriptions()

  useEffect(() => {
    // Not too useful for regular flows but on modeling view refresh,
    // fetch the token count. The regular flow is the count is initialized
    // by the Projects view.
    billingActor.send({ type: BillingTransition.Update, apiToken: authToken })

    // Tell engineStream to wait for dependencies to start streaming.
    // When leaving the modeling scene, cut the engine stream.

    return () => {
      // Add any logic to be called when the page gets unmounted.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  // Show a custom toast to users if they haven't done the onboarding
  // and they're on the web
  useEffect(() => {
    const onboardingStatus =
      settings.app.onboardingStatus.current ||
      settings.app.onboardingStatus.default
    const needsOnboarded =
      !isDesktop() && // Only show if we're in the browser,
      authToken && // we're logged in,
      searchParams.size === 0 && // we haven't come via a website "try in browser" link,
      needsToOnboard(location, onboardingStatus) // and we have an uninitialized onboarding status.

    if (needsOnboarded) {
      toast.success(
        () =>
          TutorialRequestToast({
            onboardingStatus: settings.app.onboardingStatus.current,
            navigate,
            kclManager,
            theme: getResolvedTheme(settings.app.theme.current),
            accountUrl: withSiteBaseURL('/account'),
          }),
        {
          id: ONBOARDING_TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
          icon: null,
          style: { maxInlineSize: 'min(900px, 100%)' },
        }
      )
    }
  }, [
    settings.app.onboardingStatus,
    settings.app.theme,
    location,
    navigate,
    searchParams.size,
    authToken,
  ])

  // This is, at time of writing, the only spot we need @preact/signals-react,
  // because we can't use the core `effect()` function for this signal, because
  // it is initially set to `true`, and will break the web app.
  // TODO: get the loading pattern of KclManager in order so that it's for real available,
  // then you might be able to uninstall this package and stick to just using signals-core.
  useSignalEffect(() => {
    const needsWasmInitFailedToast =
      !isDesktop() && kclManager.wasmInitFailedSignal.value
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  })

  // Only create the native file menus on desktop
  useEffect(() => {
    if (window.electron) {
      window.electron
        .createModelingPageMenu()
        .then(() => {
          setNativeFileMenuCreated(true)
        })
        .catch(reportRejection)
    }
  }, [])

  const experimentalFeaturesLevel =
    kclManager.fileSettings.experimentalFeatures ??
    DEFAULT_EXPERIMENTAL_FEATURES
  const experimentalFeaturesLocalStatusBarItems: StatusBarItemType[] =
    experimentalFeaturesLevel.type !== 'Deny'
      ? [
          {
            id: 'experimental-features',
            component: ExperimentalFeaturesMenu,
          },
        ]
      : []

  const zookeeperLocalStatusBarItems: StatusBarItemType[] = useMemo(
    () =>
      getOpenPanes({ rootLayout: layout }).includes(DefaultLayoutPaneID.TTC)
        ? [
            {
              id: 'zookeeper-credits',
              component: ZookeeperCreditsMenu,
            },
          ]
        : [],
    [layout]
  )

  const undoRedoButtons = useMemo(
    () => (
      <UndoRedoButtons
        data-testid="app-header-undo-redo"
        kclManager={kclManager}
        className="flex items-center px-2 border-x border-chalkboard-30 dark:border-chalkboard-80"
      />
    ),
    []
  )

  const notifications: boolean[] = Object.values(layout || defaultLayout).map(
    (x) => x.useNotifications?.()
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none">
      <div className="relative flex flex-1 flex-col">
        <div className="relative flex items-center flex-col">
          <AppHeader
            className="transition-opacity transition-duration-75"
            project={loaderData}
            enableMenu={true}
            nativeFileMenuCreated={nativeFileMenuCreated}
            projectMenuChildren={undoRedoButtons}
          >
            <CommandBarOpenButton />
            <ShareButton />
          </AppHeader>
        </div>
        <ModalContainer />
        <section className="pointer-events-auto flex-1">
          <LayoutRootNode
            layout={layout || defaultLayout}
            getLayout={getLayout}
            setLayout={setLayout}
            areaLibrary={defaultAreaLibrary}
            actionLibrary={defaultActionLibrary}
            showDebugPanel={settings.app.showDebugPanel.current}
            notifications={notifications}
          />
        </section>
        <StatusBar
          globalItems={[
            networkHealthStatus,
            ...(isDesktop() ? [networkMachineStatus] : []),
            ...defaultGlobalStatusBarItems({ location, filePath }),
          ]}
          localItems={[
            ...(getSettings().app.showDebugPanel.current
              ? ([
                  {
                    id: 'modeling-state',
                    element: 'text',
                    label:
                      modelingState.value instanceof Object
                        ? (xStateValueToString(modelingState.value) ?? '')
                        : modelingState.value,
                    toolTip: {
                      children: 'The current state of the modeler',
                    },
                  },
                ] satisfies StatusBarItemType[])
              : []),
            {
              id: 'selection',
              'data-testid': 'selection-status',
              element: 'text',
              label:
                getSelectionTypeDisplayText(
                  kclManager.astSignal.value,
                  modelingState.context.selectionRanges
                ) ?? 'No selection',
              toolTip: {
                children: 'Currently selected geometry',
              },
            },
            {
              id: 'units',
              component: UnitsMenu,
            },
            ...experimentalFeaturesLocalStatusBarItems,
            ...zookeeperLocalStatusBarItems,
            ...defaultLocalStatusBarItems,
          ]}
        />
      </div>
    </div>
  )
}
