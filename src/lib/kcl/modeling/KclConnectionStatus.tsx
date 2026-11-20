import { useSignals } from '@preact/signals-react/runtime'
import { ConnectionRecovery } from '@src/components/ConnectionRecovery'
import Loading from '@src/components/Loading'
import type { KclSession } from '@src/lib/kcl/modeling/session'

/** Adapts this session's connection state to the shared `Loading`/`ConnectionRecovery` views; retry calls `session.reconnect`. */
export function KclConnectionStatus({
  session,
}: {
  session: Pick<KclSession, 'state' | 'reconnect'>
}) {
  useSignals()
  const state = session.state.value
  if (state.type === 'idle')
    return (
      <ConnectionRecovery
        title="Scene paused"
        onReconnect={session.reconnect}
        className="body-bg absolute inset-0 z-50"
      />
    )
  if (state.type === 'error')
    return (
      <ConnectionRecovery
        title={state.error.message}
        onReconnect={session.reconnect}
        className="body-bg absolute inset-0 z-50"
      />
    )
  if (state.type === 'connecting')
    return (
      <Loading dataTestId="loading-engine" className="absolute inset-0 z-50">
        Connecting and setting up scene...
      </Loading>
    )
  return null
}
