import { EngineDebugger } from '@src/lib/debugger'
import { engineCommandManager } from '@src/lib/singletons'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { useEffect } from 'react'

export function useOnOfflineToExitSketchMode({
  callback,
}: { callback: () => void }) {
  useEffect(() => {
    const onOffline = (event: CustomEvent) => {
      EngineDebugger.addLog({
        label: 'useOnOfflineToExitSketchMode',
        message: 'existing sketch mode',
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
  }, [callback])
}
