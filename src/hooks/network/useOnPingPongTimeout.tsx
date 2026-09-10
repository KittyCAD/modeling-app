import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { EngineConnectionManagerEvents } from '@src/lib/engineConnection/utils'
import { useEffect } from 'react'
import { EngineDisconnectEvent } from './useOnPeerConnectionClose'

export interface IUseOnPingPongTimeout {
  callback: (eventType: EngineDisconnectEvent) => void
  engineCommandManager: ConnectionManager
}
/**
 * If we do not recieve a ping pong cycle within PONG_TIMEOUT_MS then a pingPongTimeout
 * will be dispatched during the engineCommandManager.teardown();
 */
export function useOnPingPongTimeout({
  callback,
  engineCommandManager,
}: IUseOnPingPongTimeout) {
  useEffect(() => {
    const onFailure: EventListener = (event) => {
      callback(event.type as EngineDisconnectEvent)
    }

    engineCommandManager.addEventListener(
      EngineConnectionManagerEvents.pingPongTimeout,
      onFailure
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineConnectionManagerEvents.pingPongTimeout,
        onFailure
      )
    }
  }, [callback, engineCommandManager])
}
