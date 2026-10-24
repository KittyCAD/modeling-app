import { useSignals } from '@preact/signals-react/runtime'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { useSingletons } from '@src/lib/boot'
import { EngineConnectionStateType } from '@src/lib/engineConnection/utils'

export function useReliesOnEngine(isExecuting: boolean) {
  useSignals()
  const { kclManager } = useSingletons()
  const { overallState, immediateState } = useNetworkContext()
  const isStreamReady = kclManager.engineCommandManager.isStreamReady.value
  const reliesOnEngine =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    kclManager.isExecutingSignal.value ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady

  return reliesOnEngine
}
