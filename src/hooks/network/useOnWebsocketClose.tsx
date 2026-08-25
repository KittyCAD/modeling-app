import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type {
  EngineConnectionError,
  EngineDisconnectEventDetail,
} from '@src/lib/engineConnection/utils'
import { EngineConnectionManagerEvents } from '@src/lib/engineConnection/utils'
import { useEffect } from 'react'

export interface IUseOnWebsocketClose {
  callback: (code: string | undefined) => void
  infiniteDetectionLoopCallback: (code: string | undefined) => void
  terminalErrorCallback: (
    error: EngineConnectionError,
    code: string | undefined
  ) => void
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
  terminalErrorCallback,
  engineCommandManager,
}: IUseOnWebsocketClose) {
  useEffect(() => {
    const onWebsocketClose = (
      event: CustomEvent<EngineDisconnectEventDetail>
    ) => {
      if (event.detail?.connectionError?.terminal) {
        EngineDebugger.addLog({
          label: 'useOnWebsocketClose',
          message: 'terminal Engine connection error',
          metadata: {
            code: event.detail.code,
            connectionError: event.detail.connectionError,
          },
        })
        terminalErrorCallback(event.detail.connectionError, event.detail.code)
        return
      }

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

        infiniteDetectionLoopCallback(event.detail.code)
        return
      }

      callback(event?.detail?.code)
    }

    engineCommandManager.addEventListener(
      EngineConnectionManagerEvents.WebsocketClosed,
      onWebsocketClose as EventListener
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineConnectionManagerEvents.WebsocketClosed,
        onWebsocketClose as EventListener
      )
    }
  }, [
    callback,
    infiniteDetectionLoopCallback,
    terminalErrorCallback,
    engineCommandManager,
  ])
}
