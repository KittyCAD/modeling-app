import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { EngineConnectionManagerEvents } from '@src/lib/engineConnection/utils'
import { useEffect } from 'react'

export interface IUseOnOfflineToExitSketchMode {
  callback: () => void
  engineCommandManager: ConnectionManager
}

export function useOnOfflineToExitSketchMode({
  callback,
  engineCommandManager,
}: IUseOnOfflineToExitSketchMode) {
  useEffect(() => {
    const onOffline = (event: CustomEvent) => {
      EngineDebugger.addLog({
        label: 'useOnOfflineToExitSketchMode',
        message: 'exiting sketch mode',
      })
      callback()
    }

    engineCommandManager.addEventListener(
      EngineConnectionManagerEvents.Offline,
      onOffline as EventListener
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineConnectionManagerEvents.Offline,
        onOffline as EventListener
      )
    }
  }, [callback, engineCommandManager])
}
