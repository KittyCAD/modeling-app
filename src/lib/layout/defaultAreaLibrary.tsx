import { useSignals } from '@preact/signals-react/runtime'
import { DEFAULT_SKETCH_SOLVE_STREAM_DIMMING } from '@src/clientSideScene/ClientSideSceneComp'
import { ConnectionStream } from '@src/components/ConnectionStream'
import { BodiesPane } from '@src/components/layout/areas/BodiesPane'
import { DebugPane } from '@src/components/layout/areas/DebugPane'
import { FeatureTreePane } from '@src/components/layout/areas/FeatureTreePane'
import { KclEditorPane } from '@src/components/layout/areas/KclEditorPane'
import { LogsPane } from '@src/components/layout/areas/LoggingPanes'
import { MemoryPane } from '@src/components/layout/areas/MemoryPane'
import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { kclErrorsByFilename } from '@src/lang/errors'
import { useApp, useSingletons } from '@src/lib/boot'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import type { AreaLibrary, AreaTypeDefinition } from '@src/lib/layout/types'
import { togglePaneLayoutNode } from '@src/lib/layout/utils'
import {
  EngineSceneViewExtensionOverlay,
  engineSceneStreamClassNamesValueSpec,
  engineSceneStreamLayersValueSpec,
  engineSceneViewExtensionsValueSpec,
  mergeEngineSceneClassNames,
} from '@src/registry/contracts/engineScene'
import { layoutAreaLibraryValueSpec } from '@src/lib/layout/registry/contract'
import type { MouseEventHandler } from 'react'
import { useCallback, useMemo, useState } from 'react'

function ModelingArea() {
  useSignals()
  const { auth, registry } = useApp()
  const { state, send } = useModelingContext()
  const authToken = auth.useToken()
  const [sketchSolveStreamDimming, setSketchSolveStreamDimming] = useState(
    DEFAULT_SKETCH_SOLVE_STREAM_DIMMING
  )
  const engineSceneViewExtensions = registry.signal(
    engineSceneViewExtensionsValueSpec
  ).value
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

  return (
    <div className="relative z-0 min-w-64 flex flex-col flex-1 items-center overflow-hidden">
      <ConnectionStream
        authToken={authToken}
        sketchSolveStreamDimming={sketchSolveStreamDimming}
        streamClassName={streamClassName || undefined}
        streamLayers={engineSceneStreamLayers}
        streamLayerProps={engineSceneContext}
      />
      <EngineSceneViewExtensionOverlay
        extensions={engineSceneViewExtensions}
        {...engineSceneContext}
      />
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
  ttc: testArea('Zookeeper'),
  codeEditor: testArea('Code Editor'),
  files: testArea('File Explorer'),
  logs: testArea('Logs'),
  variables: testArea('Variables'),
  debug: testArea('Debug'),
} satisfies AreaLibrary)
