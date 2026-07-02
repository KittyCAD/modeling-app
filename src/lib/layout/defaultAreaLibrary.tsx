import { useSignals } from '@preact/signals-react/runtime'
import { Toolbar } from '@src/Toolbar'
import { DEFAULT_SKETCH_SOLVE_STREAM_DIMMING } from '@src/clientSideScene/ClientSideSceneComp'
import { ConnectionStream } from '@src/components/ConnectionStream'
import { CustomIcon } from '@src/components/CustomIcon'
import Gizmo from '@src/components/gizmo/Gizmo'
import { BodiesPane } from '@src/components/layout/areas/BodiesPane'
import { DebugPane } from '@src/components/layout/areas/DebugPane'
import { FeatureTreePane } from '@src/components/layout/areas/FeatureTreePane'
import { KclEditorPane } from '@src/components/layout/areas/KclEditorPane'
import { LogsPane } from '@src/components/layout/areas/LoggingPanes'
import { MemoryPane } from '@src/components/layout/areas/MemoryPane'
import { MlEphantConversationPaneWrapper } from '@src/components/layout/areas/MlEphantConversationPaneWrapper'
import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { kclErrorsByFilename } from '@src/lang/errors'
import { useApp, useSingletons } from '@src/lib/boot'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { MODELING_AREA_CONTAINER_ID } from '@src/lib/layout/modelingArea'
import type { AreaLibrary, AreaTypeDefinition } from '@src/lib/layout/types'
import { togglePaneLayoutNode } from '@src/lib/layout/utils'
import { layoutAreaLibraryValueSpec } from '@src/registry/contracts/layout'
import type { MouseEventHandler } from 'react'
import { useCallback, useMemo, useState } from 'react'

function ModelingArea() {
  const { auth } = useApp()
  const { state, send } = useModelingContext()
  const authToken = auth.useToken()
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
      className="relative z-0 min-w-64 flex flex-col flex-1 items-center overflow-hidden"
    >
      <Toolbar />
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
