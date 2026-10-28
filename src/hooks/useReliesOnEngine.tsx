import { useComputed } from '@preact/signals-react'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { useApp, useSingletons } from '@src/lib/boot'
import { ConnectionAvailability } from '@src/lib/engineConnection/connectionManager'
import { EngineConnectionStateType } from '@src/lib/engineConnection/utils'
import { useConnectionManagerAvailabilityAsSignal } from '@src/hooks/network/useConnectionManagerAvailability'

export function useReliesOnEngine(isExecuting: boolean) {
  const { kclManager } = useSingletons()
  const { overallState, immediateState } = useNetworkContext()
  const { engineCommandManager } = useApp()
  const engineConnectionAvailability =
    useConnectionManagerAvailabilityAsSignal(engineCommandManager)
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
