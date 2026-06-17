import { useSignalEffect } from '@preact/signals-react'
import { useSignals } from '@preact/signals-react/runtime'
import { AppHeader } from '@src/components/AppHeader'
import { useLspContext } from '@src/components/LspProvider'
import { useNetworkHealthStatus } from '@src/components/NetworkHealthIndicator'
import { useNetworkMachineStatus } from '@src/components/NetworkMachineIndicator'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
import {
  defaultGlobalStatusBarItems,
  defaultLocalStatusBarItems,
} from '@src/components/StatusBar/defaultStatusBarItems'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import { UndoRedoButtons } from '@src/components/UndoRedoButtons'
import { WasmErrToast } from '@src/components/WasmErrToast'
import { ZookeeperCreditsMenu } from '@src/components/ZookeeperCreditsMenu'
import { getMlEphantProjectReloadBehavior } from '@src/components/openedProjectUtils'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'
import { useExecutingFileCommands } from '@src/hooks/useExecutingFileCommands'
import { useHotKeyListener } from '@src/hooks/useHotKeyListener'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useProjectStatus } from '@src/hooks/useProjectStatus'
import { useQueryParamEffects } from '@src/hooks/useQueryParamEffects'
import type { KclManager } from '@src/lang/KclManager'
import {
  autoUpdateDownloadProgressSignal,
  autoUpdateReadySignal,
} from '@src/lib/autoUpdate'
import { useApp, useOptionalExecutingEditor } from '@src/lib/boot'
import { createRouteCommands } from '@src/lib/commandBarConfigs/routeCommandConfig'
import {
  CHANGES_REQUESTED_TOAST_ID,
  ONBOARDING_TOAST_ID,
  WASM_INIT_FAILED_TOAST_ID,
} from '@src/lib/constants'
import { setOpfsCloudSyncProjectScope } from '@src/lib/fs-zds/opfsCloud'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { isDesktop } from '@src/lib/isDesktop'
import {
  DefaultLayoutPaneID,
  LayoutRootNode,
  defaultLayout,
  getOpenPanes,
} from '@src/lib/layout'
import { useDefaultActionLibrary } from '@src/lib/layout/defaultActionLibrary'
import { useDefaultAreaLibrary } from '@src/lib/layout/defaultAreaLibrary'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { maybeWriteToDisk } from '@src/lib/telemetry'
import { reportRejection } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { xStateValueToString } from '@src/lib/xStateValueToString'
import { BillingTransition } from '@src/machines/billingMachine'

import { useFolders, useLastOperation } from '@src/machines/systemIO/hooks'
import { SystemIOMachineStates } from '@src/machines/systemIO/utils'
import {
  filterStatusBarItemsForScopes,
  statusBarGlobalItemsValueSpec,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import {
  TutorialRequestToast,
  needsToOnboard,
  useApplyRememberedOnboardingWorkflow,
} from '@src/routes/Onboarding/utils'
import { useSelector } from '@xstate/react'
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useHotkeys } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

if (window.electron) {
  maybeWriteToDisk(window.electron)
    .then(() => {})
    .catch(reportRejection)
}

export function OpenedProject() {
  const kclManager = useOptionalExecutingEditor()
  useExecutingFileCommands()
  useProjectRouteCommands()

  if (!kclManager) {
    return <OpenedProjectWithoutExecutingFile />
  }

  return <OpenedProjectWithExecutingFile kclManager={kclManager} />
}

function useProjectRouteCommands() {
  const { commands } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const filePath = useAbsoluteFilePath()

  useEffect(() => {
    if (!filePath) {
      return
    }

    const { RouteTelemetryCommand, RouteHomeCommand, RouteSettingsCommand } =
      createRouteCommands(navigate, location, filePath)

    const routeCommands = [
      RouteTelemetryCommand,
      RouteHomeCommand,
      RouteSettingsCommand,
    ]
    commands.send({
      type: 'Add commands',
      data: {
        commands: routeCommands,
      },
    })

    return () => {
      commands.send({
        type: 'Remove commands',
        data: {
          commands: routeCommands,
        },
      })
    }
  }, [commands, filePath, location, navigate])
}

function OpenedProjectWithoutExecutingFile() {
  useSignals()
  const { auth, billing, settings, layout, project, systemIOActor, registry } =
    useApp()
  const defaultAreaLibrary = useDefaultAreaLibrary()
  const defaultActionLibrary = useDefaultActionLibrary()
  const settingsActor = settings.actor
  const [nativeFileMenuCreated, setNativeFileMenuCreated] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const autoUpdateDownloadProgress = autoUpdateDownloadProgressSignal.value
  const autoUpdateReady = autoUpdateReadySignal.value
  const lastOperation = useLastOperation()
  const projects = useFolders()
  const { onProjectOpen } = useLspContext()
  const networkHealthStatus = useNetworkHealthStatus()
  const networkMachineStatus = useNetworkMachineStatus()
  const [searchParams] = useSearchParams()
  const projectName = project?.name || null
  const projectPath = project?.path || null

  useEffect(() => {
    if (
      projects &&
      projects.length > 0 &&
      projects.every((p: Project) => p.name !== projectName) &&
      [
        SystemIOMachineStates.creatingProject,
        SystemIOMachineStates.renamingProject,
        SystemIOMachineStates.importFileFromURL,
      ].includes(lastOperation) === false
    ) {
      void navigate(PATHS.HOME)
    }

    if (projects && projects.length === 0) {
      void navigate(PATHS.HOME)
    }
  }, [projects, lastOperation, navigate, projectName])

  useEffect(() => {
    onProjectOpen({ name: projectName, path: projectPath }, null)
  }, [onProjectOpen, projectName, projectPath])

  const settingsValues = settings.useSettings()
  const machineApiEnabled = settingsValues.app.machineApi.current
  const registryGlobalStatusBarItems = filterStatusBarItemsForScopes(
    registry.signal(statusBarGlobalItemsValueSpec).value,
    ['file']
  )
  const registryLocalStatusBarItems = filterStatusBarItemsForScopes(
    registry.signal(statusBarLocalItemsValueSpec).value,
    ['file']
  )
  const authToken = auth.useToken()
  const onboardingStatusSetting = settingsValues.app.onboardingStatus
  const onboardingStatus =
    onboardingStatusSetting.current || onboardingStatusSetting.default

  useApplyRememberedOnboardingWorkflow(location.pathname, onboardingStatus)

  useHotkeys('backspace', (e) => {
    e.preventDefault()
  })

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

  useEffect(() => {
    billing.send({ type: BillingTransition.Update, apiToken: authToken })
  }, [authToken, billing])

  const href = 'href' in location ? location.href : ''

  useEffect(() => {
    const needsOnboarded =
      !window.electron &&
      authToken &&
      searchParams.size === 0 &&
      needsToOnboard(location, onboardingStatus)

    if (needsOnboarded) {
      toast.success(
        () =>
          TutorialRequestToast({
            onboardingStatus: onboardingStatusSetting.current,
            navigate,
            accountUrl: withSiteBaseURL('/account'),
            systemIOActor,
            settingsActor,
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
    onboardingStatusSetting,
    href,
    navigate,
    searchParams.size,
    authToken,
    systemIOActor,
    settingsActor,
    location,
    onboardingStatus,
  ])

  const zookeeperLocalStatusBarItems: StatusBarItemType[] = useMemo(
    () =>
      getOpenPanes({ rootLayout: layout.signal.value }).includes(
        DefaultLayoutPaneID.TTC
      )
        ? [
            {
              id: 'zookeeper-credits',
              component: ZookeeperCreditsMenu,
            },
          ]
        : [],
    [layout.signal.value]
  )

  const notifications: boolean[] = Object.values(defaultAreaLibrary).map(
    (x) => {
      if ('useNotifications' in x) {
        const obj = x.useNotifications?.()
        return obj !== undefined && Boolean(obj.value)
      }
      return false
    }
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none">
      <div className="relative flex flex-1 flex-col">
        <div className="relative flex items-center flex-col">
          <AppHeader
            className="transition-opacity transition-duration-75"
            project={project?.projectIORefSignal.value}
            file={undefined}
            enableMenu={true}
            nativeFileMenuCreated={nativeFileMenuCreated}
          />
        </div>
        <ModalContainer />
        <section className="pointer-events-auto flex-1">
          <LayoutRootNode
            layout={layout.signal.value || defaultLayout}
            getLayout={layout.get}
            setLayout={layout.set}
            areaLibrary={defaultAreaLibrary}
            actionLibrary={defaultActionLibrary}
            showDebugPanel={settingsValues.debug.showPanel.current}
            notifications={notifications}
            artifactGraph={new Map()}
          />
        </section>
        <StatusBar
          globalItems={[
            networkHealthStatus,
            ...(isDesktop() && machineApiEnabled ? [networkMachineStatus] : []),
            ...defaultGlobalStatusBarItems({
              autoUpdateDownloadProgress,
              autoUpdateReady,
              onRestartToUpdate: () => {
                window.electron?.appRestart()
              },
            }),
            ...registryGlobalStatusBarItems,
          ]}
          localItems={[
            ...registryLocalStatusBarItems,
            ...zookeeperLocalStatusBarItems,
            ...defaultLocalStatusBarItems,
          ]}
        />
      </div>
    </div>
  )
}

function OpenedProjectWithExecutingFile({
  kclManager,
}: {
  kclManager: KclManager
}) {
  useSignals()
  const { auth, billing, settings, layout, project, systemIOActor, registry } =
    useApp()
  const settingsActor = settings.actor
  const defaultAreaLibrary = useDefaultAreaLibrary()
  const defaultActionLibrary = useDefaultActionLibrary()
  const { state: modelingState, send: modelingSend } = useModelingContext()
  useQueryParamEffects()
  const [nativeFileMenuCreated, setNativeFileMenuCreated] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const autoUpdateDownloadProgress = autoUpdateDownloadProgressSignal.value
  const autoUpdateReady = autoUpdateReadySignal.value
  const lastOperation = useLastOperation()
  const projects = useFolders()
  const { onProjectOpen } = useLspContext()
  const networkHealthStatus = useNetworkHealthStatus()
  const networkMachineStatus = useNetworkMachineStatus()

  // Stream related refs and data
  const [searchParams] = useSearchParams()

  const projectName = project?.name || null
  const projectPath = project?.path || null
  const executingPath = project?.executingPath ?? null
  const executingFile = executingPath ? project?.executingFileEntry.value : null

  const systemIOState = useSelector(systemIOActor, (actor) => actor.value)

  useEffect(() => {
    setOpfsCloudSyncProjectScope(projectPath ?? undefined)

    return () => {
      setOpfsCloudSyncProjectScope(undefined)
    }
  }, [projectPath])

  // Handle our project folder disappearing (Go back to Projects listing)
  useEffect(() => {
    if (systemIOState !== SystemIOMachineStates.idle) {
      return
    }

    if (
      projects &&
      projects.length > 0 &&
      projects.every((p: Project) => p.name !== projectName) &&
      [
        SystemIOMachineStates.creatingProject,
        SystemIOMachineStates.renamingProject,
        SystemIOMachineStates.importFileFromURL,
      ].includes(lastOperation) === false
    ) {
      void navigate(PATHS.HOME)
    }

    if (projects && projects.length === 0) {
      void navigate(PATHS.HOME)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, lastOperation, systemIOState])

  // ZOOKEEPER BEHAVIOR EXCEPTION
  // Only fires on state changes, to deal with Zookeeper control.
  useEffect(() => {
    if (systemIOState !== 'idle') {
      return
    }
    if (kclManager.mlEphantManagerMachineBulkManipulatingFileSystem === false) {
      return
    }
    const reloadBehavior = getMlEphantProjectReloadBehavior(modelingState)
    kclManager.mlEphantManagerMachineBulkManipulatingFileSystem = false

    if (reloadBehavior === 'exit-sketch-solve') {
      toast(
        'Zookeeper updated the project while sketch mode was active. Exiting sketch mode to reload safely.'
      )
      modelingSend({ type: 'Exit sketch' })
      return
    }

    kclManager
      .executeCode()
      .then(async () => {
        if (reloadBehavior === 'execute-and-reset-camera') {
          await resetCameraPosition({
            sceneInfra: kclManager.sceneInfra,
            engineCommandManager: kclManager.engineCommandManager,
            settingsActor,
          })
        }
      })
      .catch(reportRejection)
  }, [systemIOState, kclManager, modelingState, modelingSend, settingsActor])

  // Run LSP file open hook when navigating between projects or files
  useEffect(() => {
    onProjectOpen(
      { name: projectName, path: projectPath },
      executingFile ?? null
    )
  }, [onProjectOpen, projectName, projectPath, executingPath, executingFile])

  useHotKeyListener(kclManager)

  const settingsValues = settings.useSettings()
  const machineApiEnabled = settingsValues.app.machineApi.current
  const registryGlobalStatusBarItems = filterStatusBarItemsForScopes(
    registry.signal(statusBarGlobalItemsValueSpec).value,
    ['file']
  )
  const registryLocalStatusBarItems = filterStatusBarItemsForScopes(
    registry.signal(statusBarLocalItemsValueSpec).value,
    ['file']
  )
  const authToken = auth.useToken()
  const currentProject = project?.projectIORefSignal.value
  const projectStatus = useProjectStatus(
    currentProject?.cloudProjectId,
    authToken
  )
  const hasChangesRequested =
    projectStatus?.publicationStatus === 'changes_requested'

  useEffect(() => {
    if (!hasChangesRequested) {
      return
    }

    const message = projectStatus?.feedback
      ? `Changes requested: ${projectStatus.feedback}. Republishing will put it back into the review queue.`
      : 'Your Aquarium submission was reviewed and changes were requested. Republishing will put it back into the review queue.'

    toast(message, {
      id: CHANGES_REQUESTED_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      icon: '⚠️',
    })

    return () => {
      toast.dismiss(CHANGES_REQUESTED_TOAST_ID)
    }
  }, [hasChangesRequested, projectStatus?.feedback])

  const onboardingStatus =
    settingsValues.app.onboardingStatus.current ||
    settingsValues.app.onboardingStatus.default

  useApplyRememberedOnboardingWorkflow(location.pathname, onboardingStatus)

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
    ['alt + shift + f'],
    () => {
      void kclManager.format()
    },
    kclManager,
    {
      enabled: !isDesktop(),
      enableOnContentEditable: true,
      enableOnFormTags: true,
      // Desktop uses the native Electron menu accelerator for this binding.
      // Skip CodeMirror registration because this combo types a character there.
      registerToCodeMirror: false,
    }
  )
  useHotkeyWrapper(
    ['ctrl + shift + c'],
    () => {
      void kclManager.convertToVariable()
    },
    kclManager
  )

  useEngineConnectionSubscriptions()

  useEffect(() => {
    // Not too useful for regular flows but on modeling view refresh,
    // fetch the token count. The regular flow is the count is initialized
    // by the Projects view.
    billing.send({ type: BillingTransition.Update, apiToken: authToken })

    // Tell engineStream to wait for dependencies to start streaming.
    // When leaving the modeling scene, cut the engine stream.

    return () => {
      // Add any logic to be called when the page gets unmounted.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  const href = 'href' in location ? location.href : ''

  // Show a custom toast to users if they haven't done the onboarding
  // and they're on the web
  useEffect(() => {
    const needsOnboarded =
      !window.electron &&
      authToken && // we're logged in,
      searchParams.size === 0 && // we haven't come via a website "try in browser" link,
      needsToOnboard(location, onboardingStatus) // and we have an uninitialized onboarding status.

    if (needsOnboarded) {
      toast.success(
        () =>
          TutorialRequestToast({
            onboardingStatus: settingsValues.app.onboardingStatus.current,
            navigate,
            accountUrl: withSiteBaseURL('/account'),
            systemIOActor,
            settingsActor,
          }),
        {
          id: ONBOARDING_TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
          icon: null,
          style: { maxInlineSize: 'min(900px, 100%)' },
        }
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settingsValues.app.onboardingStatus.current,
    settingsValues.app.theme.current,
    href,
    navigate,
    searchParams.size,
    authToken,
    kclManager,
    systemIOActor,
    settingsActor,
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

  const zookeeperLocalStatusBarItems: StatusBarItemType[] = useMemo(
    () =>
      getOpenPanes({ rootLayout: layout.signal.value }).includes(
        DefaultLayoutPaneID.TTC
      )
        ? [
            {
              id: 'zookeeper-credits',
              component: ZookeeperCreditsMenu,
            },
          ]
        : [],
    [layout.signal.value]
  )

  const undoRedoButtons = useMemo(
    () => (
      <UndoRedoButtons
        data-testid="app-header-undo-redo"
        kclManager={kclManager}
        className="flex items-center px-2 border-x border-chalkboard-30 dark:border-chalkboard-80"
      />
    ),
    [kclManager]
  )

  const notifications: boolean[] = Object.values(defaultAreaLibrary).map(
    (x) => {
      if ('useNotifications' in x) {
        const obj = x.useNotifications?.()
        return obj !== undefined && Boolean(obj.value)
      }
      return false
    }
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none">
      <div className="relative flex flex-1 flex-col">
        <div className="relative flex items-center flex-col">
          <AppHeader
            className="transition-opacity transition-duration-75"
            project={project?.projectIORefSignal.value}
            file={project?.executingFileEntry.value}
            enableMenu={true}
            nativeFileMenuCreated={nativeFileMenuCreated}
            projectMenuChildren={undoRedoButtons}
          />
        </div>
        <ModalContainer />
        <section className="pointer-events-auto flex-1">
          <LayoutRootNode
            layout={layout.signal.value || defaultLayout}
            getLayout={layout.get}
            setLayout={layout.set}
            areaLibrary={defaultAreaLibrary}
            actionLibrary={defaultActionLibrary}
            showDebugPanel={settingsValues.debug.showPanel.current}
            notifications={notifications}
            artifactGraph={kclManager.artifactGraph}
          />
        </section>
        <StatusBar
          globalItems={[
            networkHealthStatus,
            ...(isDesktop() && machineApiEnabled ? [networkMachineStatus] : []),
            ...defaultGlobalStatusBarItems({
              autoUpdateDownloadProgress,
              autoUpdateReady,
              onRestartToUpdate: () => {
                window.electron?.appRestart()
              },
            }),
            ...registryGlobalStatusBarItems,
          ]}
          localItems={[
            ...(settingsValues.debug.showModelingMachineState.current
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
            ...registryLocalStatusBarItems,
            ...zookeeperLocalStatusBarItems,
            ...defaultLocalStatusBarItems,
          ]}
        />
      </div>
    </div>
  )
}
