import type { KclViewExecution } from '@src/lib/kcl/modeling/viewExecution'
import { useSignals } from '@preact/signals-react/runtime'
import { LocalWebGPUSceneView } from '@src/clientSideScene/localRenderer/LocalWebGPUSceneView'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclSession } from '@src/lib/kcl/modeling/session'
import { KclConnectionStatus } from '@src/lib/kcl/modeling/KclConnectionStatus'
import { useEffect, useRef } from 'react'

const hiddenPlanes = { xy: false, xz: false, yz: false }

/**
 * Renders one Modeling view using the session supplied by its mode context.
 * The effect's cleanup detaches presentation through `session.attach`; the mode
 * context owns the connection and native runtime independently of sibling views.
 */
export function KclScene({
  context,
}: {
  context: {
    executor: Executor
    session: KclSession
    viewExecution: KclViewExecution
  }
}) {
  useSignals()
  const container = useRef<HTMLDivElement>(null)
  const { session, viewExecution } = context
  const state = session.state.value
  const resource = session.resource.value
  const preferences = resource?.preferences.localRenderer.value
  const output = viewExecution.state.value
  const error = output.error
  useEffect(() => {
    if (container.current) return session.attach(container.current)
  }, [session])
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={container} className="absolute inset-0" />
      {resource?.localHost && preferences && (
        <LocalWebGPUSceneView
          host={resource.localHost}
          theme={preferences.theme}
          enableSSAO={preferences.enableSSAO}
          shouldHighlightEdges={preferences.highlightEdges}
          fixedSizeGrid={preferences.fixedSizeGrid}
          backfaceColor={preferences.backfaceColor}
          pickingEnabled={false}
          defaultPlaneVisibility={hiddenPlanes}
        />
      )}
      <KclConnectionStatus session={session} />
      {state.type === 'ready' && error ? (
        <p
          role="alert"
          className="absolute bottom-4 left-4 z-50 bg-2 p-3 text-destroy-80"
        >
          {error.message}
        </p>
      ) : (
        state.type === 'ready' &&
        output.running && (
          <p
            role="status"
            className="pointer-events-none absolute bottom-4 left-4 z-50"
          >
            Executing…
          </p>
        )
      )}
    </div>
  )
}
