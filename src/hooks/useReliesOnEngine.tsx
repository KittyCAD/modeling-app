import { useAppState } from '@src/AppState'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { useOptionalExecutingEditor } from '@src/lib/boot'
import { EngineConnectionStateType } from '@src/network/utils'

export function useReliesOnEngine(isExecuting: boolean) {
  const kclManager = useOptionalExecutingEditor()
  const { overallState, immediateState } = useNetworkContext()
  const { isStreamReady } = useAppState()
  const reliesOnEngine =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    (kclManager?.isExecutingSignal.value ?? isExecuting) ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady

  return reliesOnEngine
}
