import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/network/connectionManager'
import { EngineCommandManagerEvents } from '@src/network/utils'
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
      EngineCommandManagerEvents.Offline,
      onOffline as EventListener
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.Offline,
        onOffline as EventListener
      )
    }
  }, [callback, engineCommandManager])
}
