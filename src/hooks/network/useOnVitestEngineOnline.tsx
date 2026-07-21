import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { EngineCommandManagerEvents } from '@src/lib/engineConnection/utils'
import { useEffect } from 'react'

export function useOnVitestEngineOnline({
  callback,
  engineCommandManager,
}: {
  callback: () => void
  engineCommandManager: ConnectionManager
}) {
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
  }, [callback, engineCommandManager])
}
