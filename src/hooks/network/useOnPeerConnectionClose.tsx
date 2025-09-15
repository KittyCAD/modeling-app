import { engineCommandManager } from '@src/lib/singletons'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { useEffect } from 'react'

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
