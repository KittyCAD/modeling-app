import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type {
  EngineConnectionError,
  EngineDisconnectEventDetail,
} from '@src/lib/engineConnection/utils'
import {
  EngineConnectionManagerEvents,
  WebSocketCloseCode,
} from '@src/lib/engineConnection/utils'
import { useCallback, useEffect, useRef } from 'react'

const MAX_AUTOMATIC_ABNORMAL_RECOVERIES = 3

export interface IUseOnWebsocketClose {
  callback: (code: string | undefined, reconnectRequested: boolean) => void
  infiniteDetectionLoopCallback: (code: string | undefined) => void
  terminalErrorCallback?: (
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
  const abnormalRecoveries = useRef(0)
  // Only explicit manual recovery resets the budget. A successful handshake
  // alone does not prove that replaying the model will keep the Engine alive.
  const resetAbnormalCloseRetries = useCallback(() => {
    abnormalRecoveries.current = 0
  }, [])

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
        terminalErrorCallback?.(event.detail.connectionError, event.detail.code)
        return
      }

      const code = event.detail?.code
      const reconnectRequested = event.detail?.reconnectRequested ?? false
      if (
        code === WebSocketCloseCode.AbnormalClosure.toString() &&
        !reconnectRequested
      ) {
        if (abnormalRecoveries.current >= MAX_AUTOMATIC_ABNORMAL_RECOVERIES) {
          EngineDebugger.addLog({
            label: 'useOnWebsocketClose',
            message: 'abnormal close recovery budget exhausted',
            metadata: { code, automaticRecoveries: abnormalRecoveries.current },
          })

          infiniteDetectionLoopCallback(code)
          return
        }
        abnormalRecoveries.current++
      }

      callback(code, reconnectRequested)
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
  return { resetAbnormalCloseRetries }
}
