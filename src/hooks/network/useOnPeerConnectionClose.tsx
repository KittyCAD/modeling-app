import { ConnectionManager } from '@src/network/connectionManager'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { useEffect } from 'react'

export interface IUseOnPeerConnectionClose {
  callback: () => void
  engineCommandManager: ConnectionManager
}
/**
 * During there process of engineCommandManager.start -> connection.connect() the new RTCPeerConnection
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
    const onFailure: EventListener = () => {
      callback()
    }

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.peerConnectionClosed,
      onFailure
    )

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.peerConnectionDisconnected,
      onFailure
    )

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.peerConnectionFailed,
      onFailure
    )

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.dataChannelClose,
      onFailure
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.peerConnectionClosed,
        onFailure
      )

      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.peerConnectionDisconnected,
        onFailure
      )

      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.peerConnectionFailed,
        onFailure
      )

      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.dataChannelClose,
        onFailure
      )
    }
  }, [callback, engineCommandManager])
}
