import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { getModule, init, reloadModule } from '@src/lib/wasm_lib_wrapper'
import { notifyActiveWasmInstance } from '@src/lib/wasmLifecycle'

let initializationGeneration = 0

async function publishCurrentModule(
  module: ModuleType,
  generation: number
): Promise<ModuleType> {
  if (generation !== initializationGeneration)
    return Promise.reject(
      new DOMException('Superseded Wasm initialization', 'AbortError')
    )
  // Runtime flags must be applied before callers can use this module.
  await notifyActiveWasmInstance(module)
  if (generation !== initializationGeneration)
    return Promise.reject(
      new DOMException('Superseded Wasm initialization', 'AbortError')
    )
  return module
}

export const wasmUrl = () => {
  const wasmFile = '/kcl_wasm_lib_bg.wasm'
  // Check for test environment override
  if (typeof process !== 'undefined' && process.env?.VITE_WASM_BASE_URL) {
    return process.env.VITE_WASM_BASE_URL + wasmFile
  }

  // Workers need an absolute URL to the WASM emitted with this JavaScript build.
  return new URL(
    '../../rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm',
    import.meta.url
  ).href
}

// Renderer-side WASM start entry point. New startup paths should go through
// this helper so lifecycle listeners see every active WASM instance and can
// attach runtime state like feature flags.
async function initializeFromBuffer(
  buffer: ArrayBuffer,
  generation: number
): Promise<ModuleType> {
  if (generation !== initializationGeneration)
    return Promise.reject(
      new DOMException('Superseded Wasm initialization', 'AbortError')
    )
  await reloadModule()
  if (generation !== initializationGeneration)
    return Promise.reject(
      new DOMException('Superseded Wasm initialization', 'AbortError')
    )
  await init({ module_or_path: buffer })
  const module = getModule()
  return publishCurrentModule(module, generation)
}

export const startWasmFromBuffer = (buffer: ArrayBuffer): Promise<ModuleType> =>
  initializeFromBuffer(buffer, ++initializationGeneration)

// Renderer-side WASM restart entry point. Crash recovery paths should use this
// helper for the same lifecycle notification contract as the first startup.
export const restartWasmModule = async (): Promise<ModuleType> => {
  const generation = ++initializationGeneration
  await reloadModule()
  if (generation !== initializationGeneration)
    return Promise.reject(
      new DOMException('Superseded Wasm initialization', 'AbortError')
    )
  const module = getModule()
  await module.default()
  return publishCurrentModule(module, generation)
}

// Initialise the wasm module.
export const initialiseWasm = async (): Promise<ModuleType> => {
  const generation = ++initializationGeneration
  try {
    const fullUrl = wasmUrl()
    const input = await fetch(fullUrl)
    const buffer = await input.arrayBuffer()
    return initializeFromBuffer(buffer, generation)
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
