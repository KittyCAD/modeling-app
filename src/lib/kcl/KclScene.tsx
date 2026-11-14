import { KclConnectionStatus } from '@src/lib/kcl/KclConnectionStatus'
import { useSignals } from '@preact/signals-react/runtime'
import { LocalWebGPUSceneView } from '@src/clientSideScene/localRenderer/LocalWebGPUScene'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import { useEffect, useRef } from 'react'

const hiddenPlanes = { xy: false, xz: false, yz: false }

/**
 * Renders one Modeling view using the session supplied by its mode context.
 * The effect's cleanup detaches the DOM through `session.attach`; executor-scope
 * cleanup owns closing the connection and freeing the native runtime.
 */
export function KclScene({
  context,
}: {
  context: { executor: Executor; session: KclSession }
}) {
  useSignals()
  const container = useRef<HTMLDivElement>(null)
  const { executor, session } = context
  const state = session.state.value
  const resource = session.resource.value
  const preferences = resource?.preferences.localRenderer.value
  const selection = resource?.selection
  const selectedCount = selection?.displayed.value.length ?? 0
  const output = executor.output.value
  const error = selection?.error.value ?? output.errors['kcl.execution']
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
          pickingEnabled={selection?.pickingEnabled.value ?? false}
          defaultPlaneVisibility={hiddenPlanes}
        />
      )}
      {selection && (
        <div className="absolute bottom-4 right-4 z-40 flex items-center gap-2 rounded bg-2 p-2 text-2">
          <output aria-label="Scene selection">{selectedCount} selected</output>
          <button
            type="button"
            disabled={!selectedCount || !selection.pickingEnabled.value}
            onClick={() => selection.clear()}
          >
            Clear selection
          </button>
        </div>
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
