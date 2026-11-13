import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { EngineConnectionManagerEvents } from '@src/lib/engineConnection/utils'
import { useEffect } from 'react'

export function useOnEngineOnline({
  callback,
  engineCommandManager,
}: {
  callback: () => void
  engineCommandManager: ConnectionManager
}) {
  useEffect(() => {
    const onlineRequest = () => {
      EngineDebugger.addLog({
        label: 'useOnEngineOnline',
        message: 'request engine connection. OnlineRequest triggered.',
      })
      callback()
    }

    engineCommandManager.addEventListener(
      EngineConnectionManagerEvents.OnlineRequest,
      onlineRequest
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineConnectionManagerEvents.OnlineRequest,
        onlineRequest
      )
    }
  }, [callback, engineCommandManager])
}
