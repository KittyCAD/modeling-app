import { useKclContext } from '@src/lang/KclProvider'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { useAppState } from '@src/AppState'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { EngineConnectionStateType } from '@src/network/utils'

export function useReliesOnEngine() {
  const { overallState, immediateState } = useNetworkContext()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useAppState()
  const reliesOnEngine =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    isExecuting ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady

  return reliesOnEngine
}
