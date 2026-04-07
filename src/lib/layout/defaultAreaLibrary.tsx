import { useApp, useSingletons } from '@src/lib/boot'
import { ConnectionStream } from '@src/components/ConnectionStream'
import Gizmo from '@src/components/gizmo/Gizmo'
import { Toolbar } from '@src/Toolbar'
import type { AreaType, AreaTypeDefinition } from '@src/lib/layout/types'
import { kclErrorsByFilename } from '@src/lang/errors'
import type { MouseEventHandler } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { togglePaneLayoutNode } from '@src/lib/layout/utils'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'
import { KclEditorPane } from '@src/components/layout/areas/KclEditorPane'
import { MlEphantConversationPaneWrapper } from '@src/components/layout/areas/MlEphantConversationPaneWrapper'
import { FeatureTreePane } from '@src/components/layout/areas/FeatureTreePane'
import { MemoryPane } from '@src/components/layout/areas/MemoryPane'
import { LogsPane } from '@src/components/layout/areas/LoggingPanes'
import { DebugPane } from '@src/components/layout/areas/DebugPane'
import { BodiesPane } from '@src/components/layout/areas/BodiesPane'
import { useSignals } from '@preact/signals-react/runtime'
import { MODELING_AREA_CONTAINER_ID } from '@src/lib/layout/modelingArea'
import { CustomIcon } from '@src/components/CustomIcon'
import { Draggable } from '@kittycad/ui-components'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { DEFAULT_SKETCH_SOLVE_STREAM_DIMMING } from '@src/clientSideScene/ClientSideSceneComp'
import { CustomIcon } from '@src/components/CustomIcon'

const Handle = () => (
  <div className="flex justify-center hover:bg-2">
    <CustomIcon name="three-dots" className="w-6 h-6 text-3" />
  </div>
)

function ModelingArea() {
  const { auth } = useApp()
  const { state, send } = useModelingContext()
  const authToken = auth.useToken()
  const boundingRef = useRef<HTMLDivElement>(null)
  const [sketchSolveStreamDimming, setSketchSolveStreamDimming] = useState(
    DEFAULT_SKETCH_SOLVE_STREAM_DIMMING
  )
  const showNonVisualConstraints = state.context.showNonVisualConstraints
  const streamVisibilityPercent = Math.round(
    (1 - sketchSolveStreamDimming) * 100
  )
  return (
    <div
      id={MODELING_AREA_CONTAINER_ID}
      ref={boundingRef}
      className="relative z-0 min-w-64 flex flex-col flex-1 items-center overflow-hidden"
    >
      <Toolbar />
      <Draggable
        containerRef={boundingRef}
        Handle={<Handle />}
        className="self-end relative z-50 pointer-events-auto w-full max-w-sm m-4 border b-5 rounded shadow-md bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70"
      >
        <p className="m-2">This is a draggable box</p>
      </Draggable>
      <ConnectionStream
        authToken={authToken}
        sketchSolveStreamDimming={sketchSolveStreamDimming}
      />
      {state.matches('sketchSolveMode') && (
        <div className="absolute bottom-2 left-2 z-10 flex items-end gap-2 pointer-events-auto">
          <div className="px-2 py-1 border border-chalkboard-20 dark:border-chalkboard-80 rounded bg-chalkboard-10/80 dark:bg-chalkboard-100/80 backdrop-blur-sm">
            <div className="text-[10px] text-chalkboard-70 dark:text-chalkboard-40">
              Background Opacity
            </div>
            <input
              aria-label="Sketch background opacity"
              type="range"
              min="0"
              max="100"
              step="1"
              value={streamVisibilityPercent}
              onChange={(e) => {
                const nextVisibilityPercent = Number(e.target.value)
                setSketchSolveStreamDimming((100 - nextVisibilityPercent) / 100)
              }}
              className="w-32 cursor-pointer"
            />
          </div>
          <button
            type="button"
            aria-pressed={showNonVisualConstraints}
            aria-label="Toggle non-visual constraints"
            title="Show constraints"
            onClick={() => send({ type: 'toggle non-visual constraints' })}
            className={`h-8 px-2 rounded border text-xs flex items-center gap-1.5 backdrop-blur-sm ${
              showNonVisualConstraints
                ? 'bg-primary text-chalkboard-10 border-primary'
                : 'bg-chalkboard-10/80 dark:bg-chalkboard-100/80 border-chalkboard-20 dark:border-chalkboard-80'
            }`}
          >
            <CustomIcon
              name={showNonVisualConstraints ? 'eyeOpen' : 'eyeCrossedOut'}
              className="w-4 h-4"
            />
            Constraints
          </button>
        </div>
      )}
      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
        <Gizmo />
      </div>
    </div>
  )
}

/**
 * For now we have strict area types but in future
 * we should make it possible to register your own in an extension.
 */
export const useDefaultAreaLibrary = () => {
  useSignals()
  const { settings, layout } = useApp()
  const { kclManager } = useSingletons()
  const getSettings = settings.get
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
        ttc: {
          hide: () => false,
          shortcut: 'Ctrl + T',
          cssClassOverrides: {
            button:
              'bg-ml-green pressed:bg-transparent dark:!text-chalkboard-100 hover:dark:!text-inherit dark:pressed:!text-inherit',
          },
          Component: MlEphantConversationPaneWrapper,
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
            const onClick: MouseEventHandler = (e) => {
              e.preventDefault()
              // TODO: When we have generic file open
              // If badge is pressed
              // Open the first error in the array of errors
              // Then scroll to error
              // Do you automatically open the project files
              // kclManager.scrollToFirstErrorDiagnosticIfExists()
            }
            return useMemo(() => ({ value, onClick, title }), [value, title])
          },
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
          hide: () => getSettings().app.showDebugPanel.current === false,
          shortcut: 'Shift + D',
          Component: DebugPane,
        },
      } satisfies Record<AreaType, AreaTypeDefinition>),
    [getSettings, kclManager, onCodeNotificationClick]
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
} satisfies Record<AreaType, AreaTypeDefinition>)
