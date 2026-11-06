import { useComputed, useSignals } from '@preact/signals-react/runtime'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { useApp, useSingletons } from '@src/lib/boot'
import { ConnectionAvailability } from '@src/lib/engineConnection/connectionManager'
import { EngineConnectionStateType } from '@src/lib/engineConnection/utils'
import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'

export function useReliesOnEngine(isExecuting: boolean) {
  useSignals()
  const { kclManager } = useSingletons()
  const { overallState, immediateState } = useNetworkContext()
  const { registry } = useApp()
  const engineConnectionAvailability = registry.get(
    engineConnectionService
  ).connectionAvailability
  const isStreamReady = useComputed(
    () =>
      engineConnectionAvailability.value === ConnectionAvailability.StreamReady
  )

  const reliesOnEngine =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    kclManager.isExecutingSignal.value ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady.value

  return reliesOnEngine
}
