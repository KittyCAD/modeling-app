import { EngineDebugger } from '@src/lib/debugger'
import { engineCommandManager, sceneInfra } from '@src/lib/singletons'
import { useEffect } from 'react'

/**
 * When the router path changes from /file to another path this will be an exit.  
 * For example: Going from /file to /home
 * What will not trigger this going from one /file to another /file path. That is not a router exit.
 */
export const useOnPageExit = ({ callback }: { callback: () => void }) => {
  useEffect(() => {
    return () => {
      EngineDebugger.addLog({
        label: 'useOnPageExit',
        message:
          'React component unmounted, router triggered unmount. Tear down!',
      })
      callback()
      // When the component unmounts teardown the engineCommandManager
      engineCommandManager.tearDown()
      sceneInfra.camControls.oldCameraState = undefined
    }
  }, [callback])
}
