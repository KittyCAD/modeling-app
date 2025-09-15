import { EngineDebugger } from '@src/lib/debugger'
import { engineCommandManager } from '@src/lib/singletons'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { useEffect } from 'react'

export function useOnWebsocketClose({ callback }: { callback: () => void }) {
  useEffect(() => {
    const onWebsocketClose = (event: CustomEvent) => {
      if (event.detail.websocketCloseEventCode === '1006') {
        // Most likely your internet is out. Do not try to auto reconnect
        // This will result in an infinite loop
        EngineDebugger.addLog({
          label: 'useOnWebsocketClose',
          message: 'deteched infinite loop',
          metadata: {
            webSocketCloseEventCode: event.detail.websocketCloseEventCode,
          },
        })
        return
      }

      callback()
    }

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.WebsocketClosed,
      onWebsocketClose as EventListener
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.WebsocketClosed,
        onWebsocketClose as EventListener
      )
    }
  }, [callback])
}
