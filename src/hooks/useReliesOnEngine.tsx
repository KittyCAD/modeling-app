import { useAppState } from '@src/AppState'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { useSingletons } from '@src/lib/boot'
import { EngineConnectionStateType } from '@src/network/utils'

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
