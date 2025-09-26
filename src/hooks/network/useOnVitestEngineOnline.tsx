import { EngineDebugger } from '@src/lib/debugger'
import { engineCommandManager } from '@src/lib/singletons'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { useEffect } from 'react'

export function useOnVitestEngineOnline({
  callback,
}: { callback: () => void }) {
  useEffect(() => {
    const onlineRequest = (event: CustomEvent) => {
      EngineDebugger.addLog({
        label: 'useOnVitestEngineOnline',
        message: 'request engine connection. OnlineRequest triggered.',
      })
      callback()
    }

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.OnlineRequest,
      onlineRequest as EventListener
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.OnlineRequest,
        onlineRequest as EventListener
      )
    }
  }, [callback])
}
