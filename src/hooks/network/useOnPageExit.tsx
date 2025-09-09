import { EngineDebugger } from '@src/lib/debugger'
import { engineCommandManager } from '@src/lib/singletons'
import { useEffect } from 'react'

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
    }
  }, [callback])
}
