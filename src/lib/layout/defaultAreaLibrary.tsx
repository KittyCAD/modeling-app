import { useSignals } from '@preact/signals-react/runtime'
import { DEFAULT_SKETCH_SOLVE_STREAM_DIMMING } from '@src/clientSideScene/ClientSideSceneComp'
import { ConnectionStream } from '@src/components/ConnectionStream'
import { CustomIcon } from '@src/components/CustomIcon'
import { BodiesPane } from '@src/components/layout/areas/BodiesPane'
import { DebugPane } from '@src/components/layout/areas/DebugPane'
import {
  FeatureTreePane,
  FeatureTreePaneContents,
} from '@src/components/layout/areas/FeatureTreePane'
import {
  CodeCadEditorOverlay,
  KclEditorPane,
} from '@src/components/layout/areas/KclEditorPane'
import { LogsPane } from '@src/components/layout/areas/LoggingPanes'
import { MemoryPane } from '@src/components/layout/areas/MemoryPane'
import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'
import { CleanPaneHeader } from '@src/components/layout/Panel/CleanPaneHeader'
import { cleanPaneHeaderButtonClassName } from '@src/components/layout/Panel/headerStyles'
import { PaneContentSelectorProvider } from '@src/components/layout/Panel/PaneContentSelector'
import { SplitResizeHandle } from '@src/components/layout/Panel/SplitResizeHandle'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { kclErrorsByFilename } from '@src/lang/errors'
import { AiProjectView } from '@src/lib/aiFirstCad/AiProjectView'
import { CodeCadHeaderToolbar } from '@src/lib/aiFirstCad/CodeCadHeaderToolbar'
import {
  CODE_CAD_PANE_OPTIONS,
  type CodeCadPaneContent,
  type CodeCadPaneSlot,
  useAiFirstCad,
} from '@src/lib/aiFirstCad/context'
import { AI_PROJECTS_AREA_TYPE } from '@src/lib/aiFirstCad/layouts'
import { ProjectSwitcherPane } from '@src/lib/aiFirstCad/ProjectSwitcherPane'
import { SharedProjectFilesPane } from '@src/lib/aiFirstCad/SharedProjectFilesDrawer'
import { TraditionalCadHeaderToolbar } from '@src/lib/aiFirstCad/TraditionalCadHeaderToolbar'
import { getViewExtensionsForMode } from '@src/lib/aiFirstCad/viewExtensions'
import { getWorkspacePaneAreaType } from '@src/lib/aiFirstCad/workspacePanes'
import { useApp, useSingletons } from '@src/lib/boot'
import { useLayoutState } from '@src/lib/layout/components'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { layoutAreaLibraryValueSpec } from '@src/lib/layout/registry/contract'
import {
  type AreaLibrary,
  type AreaTypeComponentProps,
  type AreaTypeDefinition,
  LayoutType,
} from '@src/lib/layout/types'
import { togglePaneLayoutNode } from '@src/lib/layout/utils'
import {
  EngineSceneViewExtensionOverlay,
  engineSceneStreamClassNamesValueSpec,
  engineSceneStreamLayersValueSpec,
  engineSceneViewExtensionsValueSpec,
  mergeEngineSceneClassNames,
} from '@src/registry/contracts/engineScene'
import type { MouseEventHandler, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { Panel, PanelGroup } from 'react-resizable-panels'

const DEFAULT_CODE_STREAM_WIDTH_PERCENT = 30
const DEFAULT_CODE_LEFT_PANE_WIDTH_PERCENT = 22
const MIN_CODE_EDITOR_WIDTH_PERCENT = 25
const MIN_CODE_STREAM_WIDTH_PERCENT = 2
const MIN_CODE_STREAM_RESTORE_PERCENT = 15
const CODE_STREAM_ANIMATION_DURATION_MS = 240

function CodeCadPaneShell({
  actions,
  children,
  headerContent,
  title,
}: {
  actions?: ReactNode
  children: ReactNode
  headerContent?: ReactNode
  title: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-default">
      <CleanPaneHeader centerContent={headerContent} title={title}>
        {actions}
      </CleanPaneHeader>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function SceneOverlayToggle({
  icon,
  label,
  onClick,
  visible,
}: {
  icon: 'layout' | 'model'
  label: string
  onClick: () => void
  visible: boolean
}) {
  const action = visible ? 'Hide' : 'Show'

  return (
    <button
      aria-label={`${action} ${label}`}
      aria-pressed={visible}
      className={`${cleanPaneHeaderButtonClassName} ${
        visible ? '!text-primary dark:!text-primary' : 'opacity-55'
      }`}
      onClick={onClick}
      title={`${action} ${label}`}
      type="button"
    >
      <CustomIcon className="h-4 w-4" name={icon} />
    </button>
  )
}

function ScenePane({
  children,
  featureTreeVisible,
  onFeatureTreeVisibleChange,
  onToolbarVisibleChange,
  toolbar,
  toolbarVisible,
}: {
  children: ReactNode
  featureTreeVisible: boolean
  onFeatureTreeVisibleChange: (visible: boolean) => void
  onToolbarVisibleChange: (visible: boolean) => void
  toolbar: ReactNode
  toolbarVisible: boolean
}) {
  return (
    <CodeCadPaneShell
      actions={
        <>
          <SceneOverlayToggle
            icon="layout"
            label="feature tree overlay"
            onClick={() => onFeatureTreeVisibleChange(!featureTreeVisible)}
            visible={featureTreeVisible}
          />
          <SceneOverlayToggle
            icon="model"
            label="modeling toolbar"
            onClick={() => onToolbarVisibleChange(!toolbarVisible)}
            visible={toolbarVisible}
          />
        </>
      }
      headerContent={
        toolbarVisible ? (
          <div className="min-w-0 flex-1" data-testid="scene-header-toolbar">
            {toolbar}
          </div>
        ) : null
      }
      title="Scene"
    >
      <div
        className="relative min-h-0 w-full flex-1 overflow-hidden"
        data-testid="scene-canvas-frame"
      >
        {children}
        {featureTreeVisible ? (
          <aside
            aria-label="Scene feature tree"
            className="scene-feature-tree-compact pointer-events-none absolute bottom-3 left-3 top-3 z-20 w-[min(20rem,42%)] min-w-40 overflow-hidden bg-transparent"
            data-testid="scene-feature-tree-overlay"
          >
            <FeatureTreePaneContents hoverScrollbar sectioned />
          </aside>
        ) : null}
      </div>
    </CodeCadPaneShell>
  )
}

function useAnimatedPanelVisibility({
  active,
  defaultSize,
  visible,
}: {
  active: boolean
  defaultSize: number
  visible: boolean
}) {
  const panelRef = useRef<ImperativePanelHandle>(null)
  const restoredSize = useRef(defaultSize)
  const isAnimating = useRef(false)
  const [isRendered, setIsRendered] = useState(visible)

  useEffect(() => {
    if (!active) {
      return
    }

    const panel = panelRef.current
    if (!panel) {
      return
    }

    const shouldCollapse = !visible
    const startingSize = panel.getSize()
    if (shouldCollapse && startingSize >= MIN_CODE_STREAM_RESTORE_PERCENT) {
      restoredSize.current = startingSize
    }
    const targetSize = shouldCollapse ? 0 : restoredSize.current
    const animationFrames: number[] = []
    const startedAt = performance.now()
    setIsRendered(true)
    isAnimating.current = true

    const animate = (now: number) => {
      const progress = Math.min(
        (now - startedAt) / CODE_STREAM_ANIMATION_DURATION_MS,
        1
      )
      const easedProgress =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - (-2 * progress + 2) ** 3 / 2
      const nextSize =
        startingSize + (targetSize - startingSize) * easedProgress

      if (progress < 1) {
        panel.resize(nextSize)
        animationFrames.push(window.requestAnimationFrame(animate))
        return
      }

      if (shouldCollapse) {
        panel.collapse()
        setIsRendered(false)
      } else {
        panel.resize(targetSize)
      }
      isAnimating.current = false
    }

    animationFrames.push(window.requestAnimationFrame(animate))
    return () => {
      for (const animationFrame of animationFrames) {
        window.cancelAnimationFrame(animationFrame)
      }
      isAnimating.current = false
    }
  }, [active, visible])

  const rememberSize = useCallback((size: number) => {
    if (!isAnimating.current && size >= MIN_CODE_STREAM_RESTORE_PERCENT) {
      restoredSize.current = size
    }
  }, [])

  return { isRendered, panelRef, rememberSize }
}

function CodeCadResizeHandle({
  interactive,
  testId,
  visible,
}: {
  interactive: boolean
  testId: string
  visible: boolean
}) {
  return (
    <SplitResizeHandle
      direction="horizontal"
      disabled={!interactive}
      id={testId}
      testId={testId}
      visible={visible}
    />
  )
}

function ModelingArea(props: AreaTypeComponentProps) {
  useSignals()
  const { auth, registry } = useApp()
  const {
    codeCadPaneAssignments,
    isCanvasGridVisible,
    isCodeLeftPaneVisible,
    isCodeStreamVisible,
    mode,
    sceneFeatureTreeVisibility,
    setCodeCadPaneContent,
    setCodeLeftPaneVisible,
    setCodeStreamVisible,
    setSceneFeatureTreeVisible,
  } = useAiFirstCad()
  const { areaLibrary } = useLayoutState()
  const { state, send } = useModelingContext()
  const authToken = auth.useToken()
  const [sketchSolveStreamDimming, setSketchSolveStreamDimming] = useState(
    DEFAULT_SKETCH_SOLVE_STREAM_DIMMING
  )
  const [isSceneToolbarVisible, setSceneToolbarVisible] = useState(true)
  const sceneMode = mode === 'manual' ? 'manual' : 'code'
  const isSceneFeatureTreeVisible = sceneFeatureTreeVisibility[sceneMode]
  const updateSceneFeatureTreeVisible = useCallback(
    (visible: boolean) => setSceneFeatureTreeVisible(sceneMode, visible),
    [sceneMode, setSceneFeatureTreeVisible]
  )
  const leftPanel = useAnimatedPanelVisibility({
    active: mode === 'code',
    defaultSize: DEFAULT_CODE_LEFT_PANE_WIDTH_PERCENT,
    visible: isCodeLeftPaneVisible,
  })
  const rightPanel = useAnimatedPanelVisibility({
    active: mode === 'code',
    defaultSize: DEFAULT_CODE_STREAM_WIDTH_PERCENT,
    visible: isCodeStreamVisible,
  })
  const engineSceneViewExtensions = registry.signal(
    engineSceneViewExtensionsValueSpec
  ).value
  const visibleEngineSceneViewExtensions = getViewExtensionsForMode(
    mode,
    engineSceneViewExtensions,
    isCanvasGridVisible
  )
  const engineSceneStreamClassNames = registry.signal(
    engineSceneStreamClassNamesValueSpec
  ).value
  const engineSceneStreamLayers =
    registry.signal(engineSceneStreamLayersValueSpec).value ?? []
  const engineSceneContext = {
    modelingState: state,
    modelingSend: send,
    sketchSolveStreamDimming,
    setSketchSolveStreamDimming,
  }
  const streamClassName = mergeEngineSceneClassNames(
    engineSceneStreamClassNames
  )
  const canvasActive = mode !== 'code' && props.layout.label === 'Canvas'

  const renderCodeCadPane = (slot: CodeCadPaneSlot, inactive: boolean) => {
    const content = codeCadPaneAssignments[slot]
    let pane: ReactNode

    if (content === 'canvas') {
      pane = (
        <div className="relative h-full min-h-0 w-full overflow-hidden">
          <ConnectionStream
            authToken={authToken}
            hidden={inactive}
            sketchSolveStreamDimming={sketchSolveStreamDimming}
            streamClassName={streamClassName || undefined}
            streamLayers={engineSceneStreamLayers}
            streamLayerProps={engineSceneContext}
          />
          {!inactive ? (
            <EngineSceneViewExtensionOverlay
              extensions={visibleEngineSceneViewExtensions}
              {...engineSceneContext}
            />
          ) : null}
          <AiProjectView active={!inactive} />
        </div>
      )
    } else if (content === 'code') {
      pane = <CodeCadEditorOverlay />
    } else if (content === 'files') {
      pane = (
        <SharedProjectFilesPane areaLibrary={areaLibrary} inactive={inactive} />
      )
    } else if (content === 'scene') {
      pane = (
        <ScenePane
          featureTreeVisible={isSceneFeatureTreeVisible}
          onFeatureTreeVisibleChange={updateSceneFeatureTreeVisible}
          onToolbarVisibleChange={setSceneToolbarVisible}
          toolbar={<CodeCadHeaderToolbar />}
          toolbarVisible={isSceneToolbarVisible}
        >
          <ConnectionStream
            authToken={authToken}
            hidden={inactive}
            sketchSolveStreamDimming={sketchSolveStreamDimming}
            streamClassName={streamClassName || undefined}
            streamLayers={engineSceneStreamLayers}
            streamLayerProps={engineSceneContext}
          />
          {!inactive ? (
            <EngineSceneViewExtensionOverlay
              extensions={visibleEngineSceneViewExtensions}
              {...engineSceneContext}
            />
          ) : null}
        </ScenePane>
      )
    } else {
      const areaType = getWorkspacePaneAreaType(content)
      const area = areaLibrary[areaType]
      if (!area) {
        return null
      }
      const { Component, ...areaConfig } = area
      pane = (
        <Component
          areaConfig={areaConfig}
          layout={{
            id: `code-cad-${slot}-${content}`,
            label:
              CODE_CAD_PANE_OPTIONS.find((option) => option.id === content)
                ?.label ?? content,
            type: LayoutType.Simple,
            areaType,
          }}
        />
      )
    }

    return (
      <PaneContentSelectorProvider
        currentId={content}
        onSelect={(nextContent) =>
          setCodeCadPaneContent(slot, nextContent as CodeCadPaneContent)
        }
        options={CODE_CAD_PANE_OPTIONS}
      >
        <div
          className="h-full min-h-0 overflow-hidden"
          data-pane-content={content}
          data-pane-slot={slot}
          data-testid={`code-cad-pane-slot-${slot}`}
        >
          {pane}
        </div>
      </PaneContentSelectorProvider>
    )
  }

  return (
    <div className="relative z-0 min-w-64 flex flex-col flex-1 items-center overflow-hidden">
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        <PanelGroup
          className="bg-transparent"
          direction="horizontal"
          id="code-cad-workspace-panels"
          keyboardResizeBy={5}
        >
          {mode === 'code' ? (
            <Panel
              className={`relative z-10 min-w-0 overflow-hidden bg-transparent ${
                leftPanel.isRendered ? '' : 'pointer-events-none invisible'
              }`}
              collapsedSize={0}
              collapsible
              defaultSize={DEFAULT_CODE_LEFT_PANE_WIDTH_PERCENT}
              id="code-cad-left-panel"
              minSize={MIN_CODE_STREAM_WIDTH_PERCENT}
              onCollapse={() => setCodeLeftPaneVisible(false)}
              onResize={leftPanel.rememberSize}
              order={0}
              ref={leftPanel.panelRef}
            >
              {renderCodeCadPane('left', !leftPanel.isRendered)}
            </Panel>
          ) : null}
          {mode === 'code' ? (
            <CodeCadResizeHandle
              interactive={isCodeLeftPaneVisible}
              testId="code-cad-left-resize-handle"
              visible={leftPanel.isRendered}
            />
          ) : null}
          {mode === 'code' ? (
            <Panel
              className="relative z-20 min-w-0 overflow-hidden bg-transparent"
              defaultSize={
                100 -
                DEFAULT_CODE_LEFT_PANE_WIDTH_PERCENT -
                DEFAULT_CODE_STREAM_WIDTH_PERCENT
              }
              id="code-cad-center-panel"
              minSize={MIN_CODE_EDITOR_WIDTH_PERCENT}
              order={1}
            >
              {renderCodeCadPane('center', false)}
            </Panel>
          ) : null}
          {mode === 'code' ? (
            <CodeCadResizeHandle
              interactive={isCodeStreamVisible}
              testId="code-cad-resize-handle"
              visible={rightPanel.isRendered}
            />
          ) : null}
          <Panel
            className={`relative z-0 flex min-h-0 flex-col overflow-hidden bg-transparent ${
              mode === 'code' && !rightPanel.isRendered
                ? 'pointer-events-none invisible'
                : ''
            }`}
            collapsedSize={mode === 'code' ? 0 : undefined}
            collapsible={mode === 'code'}
            data-testid={mode === 'code' ? 'code-cad-stream-frame' : undefined}
            defaultSize={
              mode === 'code' ? DEFAULT_CODE_STREAM_WIDTH_PERCENT : 100
            }
            id="modeling-stream-panel"
            minSize={
              mode === 'code' ? MIN_CODE_STREAM_WIDTH_PERCENT : undefined
            }
            onCollapse={
              mode === 'code' ? () => setCodeStreamVisible(false) : undefined
            }
            onResize={mode === 'code' ? rightPanel.rememberSize : undefined}
            order={2}
            ref={rightPanel.panelRef}
          >
            {mode === 'code' ? (
              renderCodeCadPane('right', !rightPanel.isRendered)
            ) : mode === 'manual' ? (
              <ScenePane
                featureTreeVisible={isSceneFeatureTreeVisible}
                onFeatureTreeVisibleChange={updateSceneFeatureTreeVisible}
                onToolbarVisibleChange={setSceneToolbarVisible}
                toolbar={<TraditionalCadHeaderToolbar />}
                toolbarVisible={isSceneToolbarVisible}
              >
                <ConnectionStream
                  authToken={authToken}
                  sketchSolveStreamDimming={sketchSolveStreamDimming}
                  streamClassName={streamClassName || undefined}
                  streamLayers={engineSceneStreamLayers}
                  streamLayerProps={engineSceneContext}
                />
                <EngineSceneViewExtensionOverlay
                  extensions={visibleEngineSceneViewExtensions}
                  {...engineSceneContext}
                />
              </ScenePane>
            ) : (
              <div className="relative h-full min-h-0 w-full overflow-hidden">
                <ConnectionStream
                  authToken={authToken}
                  sketchSolveStreamDimming={sketchSolveStreamDimming}
                  streamClassName={streamClassName || undefined}
                  streamLayers={engineSceneStreamLayers}
                  streamLayerProps={engineSceneContext}
                />
                <EngineSceneViewExtensionOverlay
                  extensions={visibleEngineSceneViewExtensions}
                  {...engineSceneContext}
                />
              </div>
            )}
          </Panel>
        </PanelGroup>
        <AiProjectView active={canvasActive} />
      </div>
    </div>
  )
}

export const useDefaultAreaLibrary = () => {
  useSignals()
  const { settings, layout, registry } = useApp()
  const { kclManager } = useSingletons()
  const getSettings = settings.get
  const registeredAreaLibrary = registry.signal(
    layoutAreaLibraryValueSpec
  ).value
  const onCodeNotificationClick: MouseEventHandler = useCallback(
    (e) => {
      e.preventDefault()
      const rootLayout = structuredClone(layout.signal.value)
      layout.set(
        togglePaneLayoutNode({
          rootLayout,
          targetNodeId: DefaultLayoutPaneID.Code,
          shouldExpand: true,
        })
      )
      kclManager.scrollToFirstErrorDiagnosticIfExists()
    },
    [kclManager, layout]
  )

  return useMemo(
    () =>
      Object.freeze({
        featureTree: {
          hide: () => false,
          shortcut: 'Shift + T',
          Component: FeatureTreePane,
        },
        bodies: {
          hide: () => false,
          Component: BodiesPane,
        },
        modeling: {
          hide: () => false,
          Component: ModelingArea,
        },
        codeEditor: {
          hide: () => false,
          shortcut: 'Shift + C',
          Component: KclEditorPane,
          useNotifications() {
            const value = kclManager.diagnosticsSignal.value.filter(
              (diagnostic) => diagnostic.severity === 'error'
            ).length
            return useMemo(() => {
              return {
                value,
                onClick: onCodeNotificationClick,
                title: undefined,
              }
            }, [value])
          },
        },
        files: {
          hide: () => false,
          shortcut: 'Shift + F',
          Component: ProjectExplorerPane,
          useNotifications() {
            const title = 'Project files have runtime errors'
            // Only compute runtime errors! Compilation errors are not tracked here.
            const errors = kclErrorsByFilename(kclManager.errorsSignal.value)
            const value = errors.size > 0 ? 'x' : ''
            const onClick: MouseEventHandler = useCallback((e) => {
              e.preventDefault()
              // TODO: When we have generic file open
              // If badge is pressed
              // Open the first error in the array of errors
              // Then scroll to error
              // Do you automatically open the project files
              // kclManager.scrollToFirstErrorDiagnosticIfExists()
            }, [])
            return useMemo(() => ({ value, onClick, title }), [value, onClick])
          },
        },
        [AI_PROJECTS_AREA_TYPE]: {
          hide: () => false,
          Component: ProjectSwitcherPane,
        },
        variables: {
          hide: () => false,
          shortcut: 'Shift + V',
          Component: MemoryPane,
        },
        logs: {
          hide: () => false,
          shortcut: 'Shift + L',
          Component: LogsPane,
        },
        debug: {
          hide: () => getSettings().debug.showPanel.current === false,
          shortcut: 'Shift + D',
          Component: DebugPane,
        },
        ...registeredAreaLibrary,
      } satisfies AreaLibrary),
    [getSettings, kclManager, onCodeNotificationClick, registeredAreaLibrary]
  )
}

function testArea(name: string): AreaTypeDefinition {
  return {
    hide: () => false,
    Component: () => (
      <div className="self-stretch flex-1 grid place-content-center">
        {name}
      </div>
    ),
  }
}

export const testAreaLibrary = Object.freeze({
  featureTree: testArea('Feature Tree'),
  bodies: testArea('bodies'),
  modeling: testArea('Modeling Scene'),
  ttc: testArea('TTC'),
  codeEditor: testArea('Code Editor'),
  files: testArea('File Explorer'),
  logs: testArea('Logs'),
  variables: testArea('Variables'),
  debug: testArea('Debug'),
} satisfies AreaLibrary)
