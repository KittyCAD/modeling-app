import { LocalWebGPUSceneView } from '@src/clientSideScene/localRenderer/LocalWebGPUScene'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import { KclConnectionStatus } from '@src/lib/kcl/KclConnectionStatus'
import { useEffect, useRef } from 'react'

const hiddenPlanes = { xy: false, xz: false, yz: false }

/** The scene session survives React mounts; this surface owns only presentation attachment. */
export function KclScene({
  context,
}: {
  context: { executor: Executor; session: KclSession }
}) {
  const container = useRef<HTMLDivElement>(null)
  const { executor, session } = context
  const state = session.state.value
  const resource = session.resource.value
  const preferences = resource?.preferences.value
  const output = executor.output.value
  const error = output.errors['kcl.execution']
  useEffect(() => {
    if (container.current) return session.mount(container.current)
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
