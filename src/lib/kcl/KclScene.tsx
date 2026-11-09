import { useSignals } from '@preact/signals-react/runtime'
import Loading from '@src/components/Loading'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclExecutorCapability } from '@src/lib/kcl/executor'
import type {
  KclSceneContext,
  KclSceneViewExtension,
} from '@src/lib/kcl/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import { EngineSceneZones } from '@src/registry/contracts/engineScene'
import { useEffect, useRef } from 'react'

/** Mount the persistent stream even while the current execution is pending or failed. */
export function KclScene({
  executor,
  capability,
  session,
  target,
  active = true,
  extensions = [],
}: {
  executor: Executor
  capability: KclExecutorCapability
  session: KclSession
  target?: KclSceneContext['target']
  active?: boolean
  extensions?: readonly KclSceneViewExtension[]
}) {
  useSignals()
  const container = useRef<HTMLDivElement>(null)
  const output = executor.output.value
  const connection = session.state.value
  const error =
    connection.type === 'error'
      ? connection.error
      : output.errors[capability.id]
  useEffect(() => {
    if (container.current) return session.mount(container.current)
  }, [session])
  return (
    <div
      className="body-bg relative flex min-h-0 min-w-0 flex-1"
      aria-label="KCL engine scene"
    >
      <div ref={container} className="min-h-0 min-w-0 flex-1" />
      {target && (
        <EngineSceneZones
          extensions={extensions}
          context={{ executor, session, target, active }}
        />
      )}
      {!error && connection.type === 'connecting' ? (
        <div role="status" className="body-bg absolute inset-0">
          <Loading isDummy className="h-full w-full">
            Connecting to the engine...
          </Loading>
        </div>
      ) : error || output.running ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 p-3">
          <p
            role={error ? 'alert' : 'status'}
            className="w-fit rounded bg-default/90 px-3 py-2 text-sm"
          >
            {error ? error.message : 'Executing KCL...'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
