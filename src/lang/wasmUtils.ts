import { webSafeJoin, webSafePathSplit } from '@src/lib/paths'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { getModule, init, reloadModule } from '@src/lib/wasm_lib_wrapper'
import { notifyActiveWasmInstance } from '@src/lib/wasmLifecycle'

export const wasmUrl = () => {
  const wasmFile = '/kcl_wasm_lib_bg.wasm'
  // Check for test environment override
  if (typeof process !== 'undefined' && process.env?.VITE_WASM_BASE_URL) {
    return process.env.VITE_WASM_BASE_URL + wasmFile
  }

  // For when we're in electron (file based) or web server (network based)
  // For some reason relative paths don't work as expected. Otherwise we would
  // just do /wasm_lib_bg.wasm. In particular, the issue arises when the path
  // is used from within worker.ts.
  const fullUrl = document.location.protocol.includes('http')
    ? document.location.origin + '/kcl_wasm_lib_bg.wasm'
    : document.location.protocol +
      webSafeJoin(webSafePathSplit(document.location.pathname).slice(0, -1)) +
      wasmFile

  return fullUrl
}

// Renderer-side WASM start entry point. New startup paths should go through
// this helper so lifecycle listeners see every active WASM instance and can
// attach runtime state like feature flags.
export const startWasmFromBuffer = async (
  buffer: ArrayBuffer
): Promise<ModuleType> => {
  await reloadModule()
  await init({ module_or_path: buffer })
  const module = getModule()
  await notifyActiveWasmInstance(module)
  return module
}

// Renderer-side WASM restart entry point. Crash recovery paths should use this
// helper for the same lifecycle notification contract as the first startup.
export const restartWasmModule = async (): Promise<ModuleType> => {
  await reloadModule()
  const module = getModule()
  await module.default()
  await notifyActiveWasmInstance(module)
  return module
}

// Initialise the wasm module.
export const initialiseWasm = async (): Promise<ModuleType> => {
  try {
    const fullUrl = wasmUrl()
    const input = await fetch(fullUrl)
    const buffer = await input.arrayBuffer()
    return startWasmFromBuffer(buffer)
  } catch (e) {
    console.log('Error initialising WASM', e)
    return Promise.reject(e)
  }
}

export function importFileExtensions(wasmInstance: ModuleType): string[] {
  return wasmInstance.import_file_extensions()
}

/**
 * All of these file extensions will be lowercase
 */
export function relevantFileExtensions(wasmInstance: ModuleType): string[] {
  return wasmInstance.relevant_file_extensions()
}
