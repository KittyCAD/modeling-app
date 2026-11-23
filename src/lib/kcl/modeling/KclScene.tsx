import { bindModelingCommandFocus } from '@src/lib/kcl/machine/commandFocus'
import { ModelingStatusBar } from '@src/lib/kcl/modeling/ModelingStatusBar'
import type { ModelingViewRuntime as ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { KclViewControls } from '@src/lib/kcl/modeling/KclViewControls'
import { useSignals } from '@preact/signals-react/runtime'
import { LocalWebGPUSceneView } from '@src/clientSideScene/localRenderer/LocalWebGPUSceneView'
import { KclConnectionStatus } from '@src/lib/kcl/modeling/KclConnectionStatus'
import { useEffect, useRef, lazy, Suspense } from 'react'

const MachineModelingView = lazy(() =>
  import('@src/lib/kcl/machine/View').then((module) => ({
    default: module.MachineModelingView,
  }))
)
const hiddenPlanes = { xy: false, xz: false, yz: false }

/**
 * Renders one Modeling view using the session supplied by its mode context.
 * The effect's cleanup detaches presentation through `session.attach`; the mode
 * context owns the connection and native runtime independently of sibling views.
 */
export function KclScene({ context }: { context: ModelingViewContext }) {
  useSignals()
  const viewport = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const { session, viewExecution, attachCameraViewport } = context
  const state = session.state.value
  const resource = session.resource.value
  const machineOwner = context.machine?.owner.value
  const preferences = resource?.preferences.localRenderer.value
  const selection = resource?.selection
  const output = viewExecution.state.value
  const error =
    context.machine?.error.value ?? selection?.error.value ?? output.error
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
  useEffect(() => {
    if (!viewport.current || !machineOwner) return
    return bindModelingCommandFocus(
      viewport.current,
      machineOwner.commandSource,
      () => !machineOwner.commands.actor.getSnapshot().matches('Closed')
    )
  }, [machineOwner])
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={container} className="absolute inset-0" />
        {resource?.localHost && preferences && (
          <LocalWebGPUSceneView
            host={resource.localHost}
            theme={preferences.theme}
            enableSSAO={preferences.enableSSAO}
            shouldHighlightEdges={preferences.highlightEdges}
            fixedSizeGrid={preferences.fixedSizeGrid}
            backfaceColor={preferences.backfaceColor}
            pickingEnabled={
              machineOwner
                ? !machineOwner.state.value.matches('sketchSolveMode')
                : (selection?.pickingEnabled.value ?? false)
            }
            defaultPlaneVisibility={
              machineOwner?.state.value.context.defaultPlaneVisibility ??
              context.interactions.active.value?.defaultPlanes.value ??
              hiddenPlanes
            }
          />
        )}
        {context.interactions.views.value.map(({ id, Component }) => (
          <Component key={id} />
        ))}
        {context.machine && machineOwner && (
          <Suspense fallback={null}>
            <MachineModelingView owner={machineOwner} context={context} />
          </Suspense>
        )}
        {resource && (
          <KclViewControls
            resource={resource}
            target={viewport}
            shortcuts={context.cameraShortcuts.value}
          />
        )}
        <KclConnectionStatus session={session} />
        {state.type === 'ready' && error && (
          <p
            role="alert"
            className="absolute bottom-4 left-4 z-50 bg-2 p-3 text-destroy-80"
          >
            {error.message}
          </p>
        )}
      </div>
      <ModelingStatusBar context={context} />
    </div>
  )
}
