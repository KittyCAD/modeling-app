import type { CameraShortcutHints } from '@src/lib/cameraViewCommands'
import type { ReadonlySignal } from '@preact/signals-core'
import type { AttachCameraViewport } from '@src/lib/kcl/modeling/cameraCommands'
import type { KclViewExecution } from '@src/lib/kcl/modeling/viewExecution'
import { KclViewControls } from '@src/lib/kcl/modeling/KclViewControls'
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
    cameraShortcuts: ReadonlySignal<CameraShortcutHints>
    attachCameraViewport: AttachCameraViewport
    executor: Executor
    session: KclSession
    viewExecution: KclViewExecution
  }
}) {
  useSignals()
  const viewport = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const { session, viewExecution, attachCameraViewport } = context
  const state = session.state.value
  const resource = session.resource.value
  const preferences = resource?.preferences.localRenderer.value
  const selection = resource?.selection
  const output = viewExecution.state.value
  const error = selection?.error.value ?? output.error
  useEffect(() => {
    if (container.current) return session.attach(container.current)
  }, [session])
  useEffect(() => {
    if (viewport.current)
      return attachCameraViewport(
        viewport.current,
        () => session.resource.value
      )
  }, [attachCameraViewport, session])
  return (
    <div ref={viewport} className="relative h-full w-full overflow-hidden">
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
      {resource && (
        <KclViewControls
          resource={resource}
          target={viewport}
          shortcuts={context.cameraShortcuts.value}
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
