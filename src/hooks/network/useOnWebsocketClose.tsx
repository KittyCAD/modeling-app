import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/network/connectionManager'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { useEffect } from 'react'

export interface IUseOnWebsocketClose {
  callback: () => void
  infiniteDetectionLoopCallback: () => void
  engineCommandManager: ConnectionManager
}

/**
 * The one location that the websocket close event will be handled within the /file page.
 * If the websocket closes we want to be able to reconnect or stop forever depending on the disconnection type
 * Look at WebSocketStatusCodes for more details on the code that is sent when the websocket close event happens
 */
export function useOnWebsocketClose({
  callback,
  infiniteDetectionLoopCallback,
  engineCommandManager,
}: IUseOnWebsocketClose) {
  useEffect(() => {
    const onWebsocketClose = (event: CustomEvent) => {
      if (event?.detail?.code === '1006') {
        // Most likely your internet is out. Do not try to auto reconnect
        // This will result in an infinite loop
        EngineDebugger.addLog({
          label: 'useOnWebsocketClose',
          message: 'detected infinite loop',
          metadata: {
            code: event?.detail?.code,
          },
        })

        infiniteDetectionLoopCallback()
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
  }, [callback, infiniteDetectionLoopCallback, engineCommandManager])
}
