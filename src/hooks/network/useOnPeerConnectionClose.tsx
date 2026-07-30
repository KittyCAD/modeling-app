import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { EngineConnectionManagerEvents } from '@src/lib/engineConnection/utils'
import { useEffect } from 'react'

export type EngineDisconnectEvent =
  | EngineConnectionManagerEvents.WebsocketClosed
  | EngineConnectionManagerEvents.peerConnectionClosed
  | EngineConnectionManagerEvents.peerConnectionDisconnected
  | EngineConnectionManagerEvents.peerConnectionFailed
  | EngineConnectionManagerEvents.dataChannelClose

export interface IUseOnPeerConnectionClose {
  callback: (eventType: EngineDisconnectEvent) => void
  engineCommandManager: ConnectionManager
}
/**
 * During the engine connection manager start -> connection.connect() process, the new RTCPeerConnection
 * class has multiple event listeners attached to the instance of the RTCPeerConnection
 * If a state change happens and it is a closed, disconnected, or failed this is the one location
 * to handle the watching of that event.
 *
 * e.g. RTCPeerConnection has a problem during runtime lets watch for that failure
 */
export function useOnPeerConnectionClose({
  callback,
  engineCommandManager,
}: IUseOnPeerConnectionClose) {
  useEffect(() => {
    // same failure handler for all for now
    const onFailure: EventListener = (event) => {
      callback(event.type as EngineDisconnectEvent)
    }

    engineCommandManager.addEventListener(
      EngineConnectionManagerEvents.peerConnectionClosed,
      onFailure
    )

    engineCommandManager.addEventListener(
      EngineConnectionManagerEvents.peerConnectionDisconnected,
      onFailure
    )

    engineCommandManager.addEventListener(
      EngineConnectionManagerEvents.peerConnectionFailed,
      onFailure
    )

    engineCommandManager.addEventListener(
      EngineConnectionManagerEvents.dataChannelClose,
      onFailure
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineConnectionManagerEvents.peerConnectionClosed,
        onFailure
      )

      engineCommandManager.removeEventListener(
        EngineConnectionManagerEvents.peerConnectionDisconnected,
        onFailure
      )

      engineCommandManager.removeEventListener(
        EngineConnectionManagerEvents.peerConnectionFailed,
        onFailure
      )

      engineCommandManager.removeEventListener(
        EngineConnectionManagerEvents.dataChannelClose,
        onFailure
      )
    }
  }, [callback, engineCommandManager])
}
