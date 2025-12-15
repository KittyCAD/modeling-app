import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/network/connectionManager'
import { useEffect } from 'react'

export interface IUseOnPageExit {
  callback: (engineCommandManager: ConnectionManager) => void
  engineCommandManager: ConnectionManager
  sceneInfra: SceneInfra
}

/**
 * When the router path changes from /file to another path this will be an exit.
 * For example: Going from /file to /home
 * What will not trigger this going from one /file to another /file path. That is not a router exit.
 */
export const useOnPageExit = ({
  callback,
  engineCommandManager,
  sceneInfra,
}: IUseOnPageExit) => {
  useEffect(() => {
    return () => {
      EngineDebugger.addLog({
        label: 'useOnPageExit',
        message:
          'React component unmounted, router triggered unmount. Tear down!',
      })
      callback(engineCommandManager)
      // When the component unmounts teardown the engineCommandManager
      EngineDebugger.addLog({
        label: 'useOnPageExit.tsx',
        message: `Exiting the page, calling tearDown()`,
      })
      engineCommandManager.tearDown()
      sceneInfra.camControls.oldCameraState = undefined
    }
  }, [callback, engineCommandManager, sceneInfra])
}
