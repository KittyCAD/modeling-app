import { PATHS } from '@src/lib/paths'
import type { IndexLoaderData } from '@src/lib/types'
import { useRouteLoaderData } from 'react-router-dom'
import { useEffect } from 'react'
import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { uuidv4 } from '@src/lib/utils'

/**
 * When the router switches from one /file route to another /file route
 * the entire DOM tree will not unmount and mount. This means <App/> will not remount
 *
 * If a connection is established with the engine and a /file route happens we need to execute the code
 */
export const useOnFileRoute = ({
  successfullyConnected,
}: { successfullyConnected: React.MutableRefObject<boolean> }) => {
  const { file } = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  useEffect(() => {
    // This will trigger on page load no matter what. The engine won't be available which will reject the first attempt to execute the file.
    // Execution will happen after the engine connection process.
    if (
      !engineCommandManager.started ||
      !engineCommandManager.connection ||
      !successfullyConnected.current
    ) {
      console.log('file changed, cannot execute code, engine is not ready')
      return
    }

    void (async () => {
      try {
        console.log('file changed, executing code')
        await kclManager.executeCode()
        // It makes sense to also call zoom to fit here, when a new file is
        // loaded for the first time, but not overtaking the work kevin did
        // so the camera isn't moving all the time.
        await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'zoom_to_fit',
            object_ids: [], // leave empty to zoom to all objects
            padding: 0.1, // padding around the objects
            animated: false, // don't animate the zoom for now
          },
        })
      } catch (e) {
        console.error(e)
      }
    })()
    /**
     * Watch file not file?.path. Watching the object allows us to send the same file.path back to back
     * and still trigger the executeCode() function. JS should not be doing a cache check on the file path
     * we should be putting the cache check in Rust.
     * e.g. We can call `navigate(/file/<>)` or `navigate(/file/<>/settings)` as much as we want and it will
     * trigger this workflow.
     */
  }, [file, successfullyConnected])
}
