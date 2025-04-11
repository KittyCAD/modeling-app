import {
  import_file_extensions,
  relevant_file_extensions,
} from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'

export function importFileExtensions(): string[] {
  return import_file_extensions()
}

export function relevantFileExtensions(): string[] {
  return relevant_file_extensions()
}
