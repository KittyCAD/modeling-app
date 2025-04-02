import toast from 'react-hot-toast'

import { kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { getModule, reloadModule } from '@src/lib/wasm_lib_wrapper'

let initialized = false

/**
 * WASM/Rust runtime can panic and the original try/catch/finally blocks will not trigger
 * on the await promise. The interface will killed. This means we need to catch the error at
 * the global/DOM level. This will have to interface with whatever controlflow that needs to be picked up
 * within the error branch in the typescript to cover the application state.
 */
export const initializeWindowExceptionHandler = () => {
  if (window && !initialized) {
    window.addEventListener('error', (event) => {
      void (async () => {
        if (matchImportExportErrorCrash(event.message)) {
          // do global singleton cleanup
          kclManager.executeAstCleanUp()
          toast.error(
            'You have hit a KCL execution bug! Put your KCL code in a github issue to help us resolve this bug.'
          )
          try {
            await reloadModule()
            await getModule().default()
          } catch (e) {
            console.error('Failed to initialize wasm_lib')
            console.error(e)
          }
        }
      })().catch(reportRejection)
    })
    // Make sure we only initialize this event listener once
    initialized = true
  } else {
    console.error(
      `Failed to initialize, window: ${window}, initialized:${initialized}`
    )
  }
}

/**
 * Specifically match a substring of the message error to detect an import export runtime issue
 * when the WASM runtime panics
 */
const matchImportExportErrorCrash = (message: string): boolean => {
  // called `Result::unwrap_throw()` on an `Err` value
  const substringError = '`Result::unwrap_throw()` on an `Err` value'
  return message.indexOf(substringError) !== -1 ? true : false
}
