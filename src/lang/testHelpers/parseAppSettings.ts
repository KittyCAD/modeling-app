import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { DeepPartial } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

// Keep the Rust parser available for integration fixtures and boundary tests.
export function parseAppSettings(
  toml: string,
  wasmInstance: ModuleType
): DeepPartial<Configuration> | Error {
  return wasmInstance.parse_app_settings(toml)
}
