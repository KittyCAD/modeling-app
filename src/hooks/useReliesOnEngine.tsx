import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { useAppState } from '@src/AppState'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { EngineConnectionStateType } from '@src/network/utils'
import { useSingletons } from '@src/lib/singletons'

export function useReliesOnEngine(isExecuting: boolean) {
  const { kclManager } = useSingletons()
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
