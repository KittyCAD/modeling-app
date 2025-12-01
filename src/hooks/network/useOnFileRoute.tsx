import { useEffect, useRef } from 'react'
import type { FileEntry } from '@src/lib/project'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { KclManager } from '@src/lang/KclManager'
import type { resetCameraPosition } from '@src/lib/resetCameraPosition'

export interface IUseOnFileRoute {
  file: FileEntry | undefined
  isStreamAcceptingInput: boolean
  engineCommandManager: ConnectionManager
  kclManager: KclManager
  resetCameraPosition: typeof resetCameraPosition
}

/**
 * When the router switches from one /file route to another /file route
 * the entire DOM tree will not unmount and mount. This means <App/> will not remount
 *
 * If a connection is established with the engine and a /file route happens we need to execute the code
 */
export const useOnFileRoute = ({
  file,
  isStreamAcceptingInput,
  engineCommandManager,
  kclManager,
  resetCameraPosition,
}: IUseOnFileRoute) => {
  const seenFilePath = useRef('')
  useEffect(() => {
    // This will trigger on page load no matter what. The engine won't be available which will reject the first attempt to execute the file.
    // Execution will happen after the engine connection process.
    if (
      !engineCommandManager.started ||
      !engineCommandManager.connection ||
      !isStreamAcceptingInput
    ) {
      console.log('file changed, cannot execute code, engine is not ready')
      return
    }

    if (seenFilePath.current === file?.path || seenFilePath.current === '') {
      // Return early because you would double execute
      seenFilePath.current = file?.path || ''
      return
    }

    // Keep track of the file you just saw
    seenFilePath.current = file?.path || ''

    void (async () => {
      try {
        console.log('file changed, executing code')
        await kclManager.executeCode()
        await resetCameraPosition()
      } catch (e) {
        console.warn(e)
      }
    })()
    /**
     * Watch file not file?.path. Watching the object allows us to send the same file.path back to back
     * and still trigger the executeCode() function. JS should not be doing a cache check on the file path
     * we should be putting the cache check in Rust.
     * e.g. We can call `navigate(/file/<>)` or `navigate(/file/<>/settings)` as much as we want and it will
     * trigger this workflow.
     */
  }, [
    file,
    isStreamAcceptingInput,
    engineCommandManager,
    kclManager,
    resetCameraPosition,
  ])
}
