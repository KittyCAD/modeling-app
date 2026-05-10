import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { useAppState } from '@src/AppState'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { EngineConnectionStateType } from '@src/network/utils'
import { useApp, useSingletons } from '@src/lib/boot'

export function useReliesOnEngine(isExecuting: boolean) {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { overallState, immediateState } = useNetworkContext()
  const { isStreamReady } = useAppState()
  const modelingEngine = settings.useSettings().modeling.engine.current

  if (modelingEngine === 'open_cascade') {
    return false
  }

  const reliesOnEngine =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    isExecuting ||
    kclManager.isExecutingSignal.value ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady

  return reliesOnEngine
}
