import { engineCommandManager } from '@src/lib/singletons'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { useEffect } from 'react'

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
}: { callback: () => void }) {
  useEffect(() => {
    // same failure handler for all for now
    const onFailure = () => {
      callback()
    }

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.peerConnectionClosed,
      onFailure as EventListener
    )

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.peerConnectionDisconnected,
      onFailure as EventListener
    )

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.peerConnectionFailed,
      onFailure as EventListener
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.peerConnectionClosed,
        onFailure as EventListener
      )

      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.peerConnectionDisconnected,
        onFailure as EventListener
      )

      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.peerConnectionFailed,
        onFailure as EventListener
      )
    }
  }, [callback])
}
