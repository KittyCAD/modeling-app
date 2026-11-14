import { KclConnectionStatus } from '@src/lib/kcl/KclConnectionStatus'
import { ModelingToolbar } from '@src/lib/kcl/ModelingToolbar'
import { ModelingStatusBar } from '@src/lib/kcl/ModelingStatusBar'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { useSignals } from '@preact/signals-react/runtime'
import { LocalWebGPUSceneView } from '@src/clientSideScene/localRenderer/LocalWebGPUScene'
import { useEffect, useRef } from 'react'

const hiddenPlanes = { xy: false, xz: false, yz: false }

/**
 * Renders one Modeling view using the session supplied by its mode context.
 * The effect's cleanup detaches the DOM through `session.attach`; executor-scope
 * cleanup owns closing the connection and freeing the native runtime.
 */
export function KclScene({ context }: { context: ModelingViewContext }) {
  useSignals()
  const container = useRef<HTMLDivElement>(null)
  const { executor, session } = context
  const state = session.state.value
  const resource = session.resource.value
  const preferences = resource?.preferences.localRenderer.value
  const selection = resource?.selection
  const output = executor.output.value
  const error = selection?.error.value ?? output.errors['kcl.execution']
  useEffect(() => {
    if (container.current) return session.attach(container.current)
  }, [session])
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={container} className="absolute inset-0" />
        {resource?.localHost && preferences && (
          <LocalWebGPUSceneView
            host={resource.localHost}
            theme={preferences.theme}
            enableSSAO={preferences.enableSSAO}
            shouldHighlightEdges={preferences.highlightEdges}
            fixedSizeGrid={preferences.fixedSizeGrid}
            backfaceColor={preferences.backfaceColor}
            pickingEnabled={selection?.pickingEnabled.value ?? false}
            defaultPlaneVisibility={hiddenPlanes}
          />
        )}
        <ModelingToolbar context={context} />
        <KclConnectionStatus session={session} />
        {state.type === 'ready' && error ? (
          <p
            role="alert"
            className="absolute bottom-4 left-4 z-50 bg-2 p-3 text-destroy-80"
          >
            {error.message}
          </p>
        ) : null}
      </div>
      <ModelingStatusBar context={context} />
    </div>
  )
}
