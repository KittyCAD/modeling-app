import { KclConnectionStatus } from '@src/lib/kcl/KclConnectionStatus'
import { ModelingStatusBar } from '@src/lib/kcl/ModelingStatusBar'
import type { ModelingViewRuntime as ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { useSignals } from '@preact/signals-react/runtime'
import { LocalWebGPUSceneView } from '@src/clientSideScene/localRenderer/LocalWebGPUScene'
import { useEffect, useRef, lazy, Suspense } from 'react'
import { reportRejection } from '@src/lib/trap'

const MachineModelingView = lazy(() =>
  import('@src/lib/kcl/machine/View').then((module) => ({
    default: module.MachineModelingView,
  }))
)

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
  const machineOwner = context.machine?.owner.value
  const preferences = resource?.preferences.localRenderer.value
  const selection = resource?.selection
  const output = executor.output.value
  const error =
    context.machine?.error.value ??
    selection?.error.value ??
    output.errors['kcl.execution']
  useEffect(() => {
    if (container.current) return session.attach(container.current)
  }, [session])
  useEffect(() => {
    const root = container.current?.parentElement
    if (!root) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return
      const session = context.interactions.active.peek()
      if (session) {
        event.preventDefault()
        event.stopPropagation()
        session.escape().catch(reportRejection)
      }
    }
    root.addEventListener('keydown', key)
    return () => root.removeEventListener('keydown', key)
  }, [context])
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
