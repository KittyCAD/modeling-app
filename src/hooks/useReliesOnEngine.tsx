import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { useAppState } from '@src/AppState'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { EngineConnectionStateType } from '@src/network/utils'
import { kclManager } from '@src/lib/singletons'

export function useReliesOnEngine() {
  const { overallState, immediateState } = useNetworkContext()
  const { isStreamReady } = useAppState()
  const reliesOnEngine =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    kclManager.isExecutingSignal.value ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady

  return reliesOnEngine
}
