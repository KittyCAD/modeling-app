import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { useAppState } from '@src/AppState'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { EngineConnectionStateType } from '@src/network/utils'
import { useExecutingEditor } from '@src/components/ProjectEditorProviders'
import { useEffect } from 'react'

export function useReliesOnEngine(isExecuting: boolean) {
  const { editor: kclManager } = useExecutingEditor()
  const { overallState, immediateState } = useNetworkContext()
  const { isStreamReady } = useAppState()
  const reliesOnEngine =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    kclManager.isExecutingSignal.value ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady

  useEffect(() => {
    console.log('reliesOnEngine', reliesOnEngine)
    debugger
  }, [reliesOnEngine])

  return reliesOnEngine
}
