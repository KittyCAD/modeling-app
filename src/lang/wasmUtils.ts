import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
export {
  initialiseWasm,
  startWasmFromBuffer,
  wasmUrl,
} from '@src/lib/wasmRuntime'

export function importFileExtensions(wasmInstance: ModuleType): string[] {
  return wasmInstance.import_file_extensions()
}

/**
 * All of these file extensions will be lowercase
 */
export function relevantFileExtensions(wasmInstance: ModuleType): string[] {
  return wasmInstance.relevant_file_extensions()
}
