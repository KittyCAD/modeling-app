import { useSignalEffect } from '@preact/signals-react'
import { useSignals } from '@preact/signals-react/runtime'
import { AppHeader } from '@src/components/AppHeader'
import { getMlEphantProjectReloadBehavior } from '@src/components/openedProjectUtils'
import { WasmErrToast } from '@src/components/WasmErrToast'
import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'
import { useHotKeyListener } from '@src/hooks/useHotKeyListener'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useProjectStatus } from '@src/hooks/useProjectStatus'
import { useQueryParamEffects } from '@src/hooks/useQueryParamEffects'
import { lspService } from '@src/lang/lsp/registry/contract'
import { AiPaneToggleButton } from '@src/lib/aiFirstCad/AiPaneToggleButton'
import { CadModeToggle } from '@src/lib/aiFirstCad/CadModeToggle'
import {
  type AiFirstCadMode,
  AiFirstCadProvider,
  getCodeCadPaneLabel,
  useAiFirstCad,
} from '@src/lib/aiFirstCad/context'
import {
  AI_CANVAS_PANEL_ID,
  AI_PROJECTS_PANEL_ID,
  aiFirstLayoutConfig,
  codeCadLayoutConfig,
  manualFirstLayoutConfig,
} from '@src/lib/aiFirstCad/layouts'
import { WorkspaceDrawer } from '@src/lib/aiFirstCad/SharedProjectFilesDrawer'
import {
  getWorkspacePaneLabel,
  getWorkspacePaneLabelForArea,
  WORKSPACE_PANE_OPTIONS,
  type WorkspacePaneContent,
} from '@src/lib/aiFirstCad/workspacePanes'
import { BillingTransition } from '@src/lib/billing'
import { useApp, useSingletons } from '@src/lib/boot'
import { setCloudSyncProjectScope } from '@src/lib/cloudSync'
import {
  CHANGES_REQUESTED_TOAST_ID,
  ONBOARDING_TOAST_ID,
  WASM_INIT_FAILED_TOAST_ID,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import type { Layout } from '@src/lib/layout'
import { LayoutRootNode } from '@src/lib/layout'
import { useDefaultActionLibrary } from '@src/lib/layout/defaultActionLibrary'
import { useDefaultAreaLibrary } from '@src/lib/layout/defaultAreaLibrary'
import { findLayoutChildNode } from '@src/lib/layout/utils'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { maybeWriteToDisk } from '@src/lib/telemetry'
import { reportRejection } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

import { useFolders, useLastOperation } from '@src/machines/systemIO/hooks'
import { SystemIOMachineStates } from '@src/machines/systemIO/utils'
import {
  needsToOnboard,
  TutorialRequestToast,
  useApplyRememberedOnboardingWorkflow,
} from '@src/routes/Onboarding/utils'
import { useSelector } from '@xstate/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import ModalContainer from 'react-modal-promise'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

if (window.electron) {
  maybeWriteToDisk(window.electron)
    .then(() => {})
    .catch(reportRejection)
}

const AI_COLLAPSIBLE_PANEL_IDS = [
  AI_PROJECTS_PANEL_ID,
  AI_CANVAS_PANEL_ID,
] as const

export function OpenedProject() {
  return (
    <AiFirstCadProvider>
      <OpenedProjectContents />
    </AiFirstCadProvider>
  )
}

function OpenedProjectContents() {
  useSignals()
  const { auth, billing, settings, project, systemIOActor, registry } = useApp()
  const {
    codeCadPaneAssignments,
    isCodeLeftPaneVisible,
    isCodeStreamVisible,
    mode,
    setCodeLeftPaneVisible,
    setCodeStreamVisible,
  } = useAiFirstCad()
  const { kclManager } = useSingletons()
  const settingsActor = settings.actor
  const defaultAreaLibrary = useDefaultAreaLibrary()
  const defaultActionLibrary = useDefaultActionLibrary()
  const { state: modelingState, send: modelingSend } = useModelingContext()
  useQueryParamEffects(kclManager)
  const [nativeFileMenuCreated, setNativeFileMenuCreated] = useState(false)
  const [isProjectsPaneCollapsed, setIsProjectsPaneCollapsed] = useState(false)
  const [isCanvasPaneCollapsed, setIsCanvasPaneCollapsed] = useState(false)
  const [
    isTraditionalCadLeftDrawerCollapsed,
    setIsTraditionalCadLeftDrawerCollapsed,
  ] = useState(false)
  const [traditionalCadLeftDrawerContent, setTraditionalCadLeftDrawerContent] =
    useState<WorkspacePaneContent>('files')
  const [
    isTraditionalCadRightDrawerCollapsed,
    setIsTraditionalCadRightDrawerCollapsed,
  ] = useState(true)
  const [
    traditionalCadRightDrawerContent,
    setTraditionalCadRightDrawerContent,
  ] = useState<WorkspacePaneContent>('projects')
  const [rndLayouts, setRndLayouts] = useState<Record<AiFirstCadMode, Layout>>(
    () => ({
      ai: structuredClone(aiFirstLayoutConfig),
      manual: structuredClone(manualFirstLayoutConfig),
      code: structuredClone(codeCadLayoutConfig),
    })
  )
  const activeLayout = rndLayouts[mode]
  const getLayoutPaneLabel = useCallback(
    (layout: Layout, panelId: string, fallbackLabel: string) => {
      const panel = findLayoutChildNode({
        rootLayout: layout,
        targetNodeId: panelId,
      })
      return panel && 'areaType' in panel
        ? getWorkspacePaneLabelForArea(panel.areaType, panel.label)
        : fallbackLabel
    },
    []
  )
  const getActiveLayout = useCallback(() => activeLayout, [activeLayout])
  const setActiveLayout = useCallback(
    (nextLayout: Layout) => {
      setRndLayouts((layouts) => ({ ...layouts, [mode]: nextLayout }))
    },
    [mode]
  )
  const collapsedAiPanelIds = useMemo(
    () => [
      ...(isProjectsPaneCollapsed ? [AI_PROJECTS_PANEL_ID] : []),
      ...(isCanvasPaneCollapsed ? [AI_CANVAS_PANEL_ID] : []),
    ],
    [isCanvasPaneCollapsed, isProjectsPaneCollapsed]
  )
  const collapsedPanelIds = mode === 'ai' ? collapsedAiPanelIds : []
  const collapsiblePanelIds = mode === 'ai' ? AI_COLLAPSIBLE_PANEL_IDS : []
  const onPanelCollapsedChange = useCallback(
    (panelId: string, collapsed: boolean) => {
      if (panelId === AI_PROJECTS_PANEL_ID) {
        setIsProjectsPaneCollapsed(collapsed)
      } else if (panelId === AI_CANVAS_PANEL_ID) {
        setIsCanvasPaneCollapsed(collapsed)
      }
    },
    []
  )
  const location = useLocation()
  const navigate = useNavigate()
  const lastOperation = useLastOperation()
  const projects = useFolders()
  const lsp = registry.get(lspService)

  // Stream related refs and data
  const [searchParams] = useSearchParams()

  const projectName = project?.name || null
  const projectPath = project?.path || null

  const systemIOState = useSelector(systemIOActor, (actor) => actor.value)

  useEffect(() => {
    setCloudSyncProjectScope(projectPath ?? undefined)

    return () => {
      setCloudSyncProjectScope(undefined)
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
    lsp.onProjectOpen(
      { name: projectName, path: projectPath },
      project?.executingPath ? project.executingFileEntry.value : null
    )
  }, [lsp, projectName, projectPath, project])

  useHotKeyListener(kclManager)

  const settingsValues = settings.useSettings()
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
            kclManager,
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
    <div
      className={`h-screen flex flex-col overflow-hidden select-none ${
        mode === 'ai' ? 'dark:bg-[#181818]' : ''
      }`}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex items-center flex-col">
          <AppHeader
            className={`transition-opacity transition-duration-75 ${
              mode === 'ai' ? 'dark:!bg-[#181818]' : ''
            }`}
            project={project?.projectIORefSignal.value}
            file={project?.executingFileEntry.value}
            enableMenu={true}
            nativeFileMenuCreated={nativeFileMenuCreated}
            showProjectSelector={false}
            hiddenItemIds={['command-bar.open', 'publish.open']}
            leadingActions={
              mode === 'ai' ? (
                <AiPaneToggleButton
                  collapsed={isProjectsPaneCollapsed}
                  label={getLayoutPaneLabel(
                    rndLayouts.ai,
                    AI_PROJECTS_PANEL_ID,
                    'Projects'
                  )}
                  onClick={() =>
                    setIsProjectsPaneCollapsed((collapsed) => !collapsed)
                  }
                  side="left"
                />
              ) : mode === 'code' ? (
                <AiPaneToggleButton
                  collapsed={!isCodeLeftPaneVisible}
                  label={getCodeCadPaneLabel(codeCadPaneAssignments.left)}
                  onClick={() => setCodeLeftPaneVisible(!isCodeLeftPaneVisible)}
                  side="left"
                />
              ) : (
                <AiPaneToggleButton
                  collapsed={isTraditionalCadLeftDrawerCollapsed}
                  label={getWorkspacePaneLabel(traditionalCadLeftDrawerContent)}
                  onClick={() =>
                    setIsTraditionalCadLeftDrawerCollapsed(
                      (collapsed) => !collapsed
                    )
                  }
                  side="left"
                />
              )
            }
            headerActions={
              <>
                <CadModeToggle />
                {mode === 'ai' ? (
                  <AiPaneToggleButton
                    collapsed={isCanvasPaneCollapsed}
                    label={getLayoutPaneLabel(
                      rndLayouts.ai,
                      AI_CANVAS_PANEL_ID,
                      'Canvas'
                    )}
                    onClick={() =>
                      setIsCanvasPaneCollapsed((collapsed) => !collapsed)
                    }
                    side="right"
                  />
                ) : mode === 'code' ? (
                  <AiPaneToggleButton
                    collapsed={!isCodeStreamVisible}
                    label={getCodeCadPaneLabel(codeCadPaneAssignments.right)}
                    onClick={() => setCodeStreamVisible(!isCodeStreamVisible)}
                    side="right"
                  />
                ) : (
                  <AiPaneToggleButton
                    collapsed={isTraditionalCadRightDrawerCollapsed}
                    label={getWorkspacePaneLabel(
                      traditionalCadRightDrawerContent
                    )}
                    onClick={() =>
                      setIsTraditionalCadRightDrawerCollapsed(
                        (collapsed) => !collapsed
                      )
                    }
                    side="right"
                  />
                )}
              </>
            }
          />
        </div>
        <ModalContainer />
        <section
          className={`pointer-events-auto min-h-0 flex-1 overflow-hidden ${
            mode === 'ai' ? 'dark:bg-[#181818]' : ''
          }`}
        >
          <div className="flex h-full min-w-0">
            {mode === 'manual' && (
              <WorkspaceDrawer
                areaLibrary={defaultAreaLibrary}
                collapsed={isTraditionalCadLeftDrawerCollapsed}
                content={traditionalCadLeftDrawerContent}
                onContentChange={setTraditionalCadLeftDrawerContent}
                side="left"
              />
            )}
            <div className="min-w-0 flex-1">
              <LayoutRootNode
                areaSelectorOptions={WORKSPACE_PANE_OPTIONS}
                layout={activeLayout}
                getLayout={getActiveLayout}
                setLayout={setActiveLayout}
                areaLibrary={defaultAreaLibrary}
                actionLibrary={defaultActionLibrary}
                collapsedPanelIds={collapsedPanelIds}
                collapsiblePanelIds={collapsiblePanelIds}
                hideResizeHandleLines={mode === 'ai'}
                onPanelCollapsedChange={
                  mode === 'ai' || mode === 'code'
                    ? onPanelCollapsedChange
                    : undefined
                }
                showDebugPanel={settingsValues.debug.showPanel.current}
                notifications={notifications}
                artifactGraph={kclManager.artifactGraph}
              />
            </div>
            {mode === 'manual' && (
              <WorkspaceDrawer
                areaLibrary={defaultAreaLibrary}
                collapsed={isTraditionalCadRightDrawerCollapsed}
                content={traditionalCadRightDrawerContent}
                onContentChange={setTraditionalCadRightDrawerContent}
                side="right"
              />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
