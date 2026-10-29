import type { KclManager } from '@src/lang/KclManager'
import { restartWasmModule } from '@src/lib/wasmRuntime'
import { recoverRustContext } from '@src/lib/rustContext'
import { reportRejection } from '@src/lib/trap'
import toast from 'react-hot-toast'

let initialized = false

interface WasmCrashRecoveryTarget {
  engineCommandManager: Pick<
    KclManager['engineCommandManager'],
    'captureFailedExecutionCleanup'
  >
  executeAstCleanUp: KclManager['executeAstCleanUp']
  wasmInstancePromise: KclManager['wasmInstancePromise']
  rustContext: object
}

/**
 * WASM/Rust runtime can panic and the original try/catch/finally blocks will not trigger
 * on the await promise. The interface will killed. This means we need to catch the error at
 * the global/DOM level. This will have to interface with whatever controlflow that needs to be picked up
 * within the error branch in the typescript to cover the application state.
 */
export const initializeWindowExceptionHandler = (
  kclManager: WasmCrashRecoveryTarget
) => {
  if (window && !initialized) {
    window.addEventListener('error', (event) => {
      void (async () => {
        if (
          matchImportExportErrorCrash(event.message) ||
          matchUnreachableErrorCrash(event.message) ||
          matchStackSizeExceededErrorCrash(event.message) ||
          matchMemoryAccessOutOfBoundsErrorCrash(event.message) ||
          matchGenericWasmRuntimeHeuristicErrorCrash(event)
        ) {
          const finishFailedExecutions =
            kclManager.engineCommandManager.captureFailedExecutionCleanup()

          try {
            kclManager.executeAstCleanUp()
            toast.error(
              'You have hit a KCL execution bug! Put your KCL code in a github issue to help us resolve this bug.'
            )
            const newModulePromise = restartWasmModule()
            // Refresh kclManager singleton's reference to the current WASM module.
            kclManager.wasmInstancePromise = newModulePromise
            // A live context cannot survive a crashed module. Construct a new
            // one and replay its current project, including unsaved edits.
            await recoverRustContext(kclManager.rustContext, newModulePromise)
          } catch (e) {
            console.error('Failed to initialize wasm_lib')
            console.error(e)
          } finally {
            // Release abandoned execution tracking whether recovery succeeds or not.
            finishFailedExecutions()
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

const matchUnreachableErrorCrash = (message: string): boolean => {
  const substringError = `Uncaught RuntimeError: unreachable`
  return message.indexOf(substringError) !== -1 ? true : false
}

function matchStackSizeExceededErrorCrash(message: string): boolean {
  const substringError = `Uncaught RangeError: Maximum call stack size exceeded`
  return message.indexOf(substringError) !== -1
}

// This can happen when running out of stack memory, especially in debug builds
// where extra memory allocations aren't optimized away.
function matchMemoryAccessOutOfBoundsErrorCrash(message: string): boolean {
  const substringError = `Uncaught RuntimeError: memory access out of bounds`
  return message.indexOf(substringError) !== -1
}

const matchGenericWasmRuntimeHeuristicErrorCrash = (
  error: ErrorEvent
): boolean => {
  const stack = error?.error?.stack || null
  if (typeof stack === 'string') {
    const substringError = `WebAssembly.instantiate:wasm-function`
    return stack.indexOf(substringError) !== -1 ? true : false
  }

  return false
}
