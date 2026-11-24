import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/** Query the supplied native module without importing its loader or starting WASM. */
export function importFileExtensions(
  wasmInstance: Pick<ModuleType, 'import_file_extensions'>
): string[] {
  return wasmInstance.import_file_extensions()
}

/** Native-supported import and source extensions, all lowercase. */
export function relevantFileExtensions(
  wasmInstance: Pick<ModuleType, 'relevant_file_extensions'>
): string[] {
  return wasmInstance.relevant_file_extensions()
}
