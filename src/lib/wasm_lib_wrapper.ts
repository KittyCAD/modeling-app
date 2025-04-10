/**
 * This wrapper file is to enable reloading of the wasm_lib.js file.
 * When the wasm instance bricks there is no API or interface to restart,
 * restore, or re init the WebAssembly instance. The entire application would need
 * to restart.
 * A way to bypass this is by reloading the entire .js file so the global wasm variable
 * gets reinitialized and we do not use that old reference
 */
import type {
  base64_decode as Base64Decode,
  change_kcl_settings as ChangeKclSettings,
  coredump as CoreDump,
  default_app_settings as DefaultAppSettings,
  default_project_settings as DefaultProjectSettings,
  format_number as FormatNumber,
  get_kcl_version as GetKclVersion,
  get_tangential_arc_to_info as GetTangentialArcToInfo,
  is_kcl_empty_or_only_settings as IsKclEmptyOrOnlySettings,
  is_points_ccw as IsPointsCcw,
  kcl_lint as KclLint,
  kcl_settings as KclSettings,
  parse_app_settings as ParseAppSettings,
  parse_project_settings as ParseProjectSettings,
  parse_wasm as ParseWasm,
  recast_wasm as RecastWasm,
  serialize_configuration as SerializeConfiguration,
  serialize_project_configuration as SerializeProjectConfiguration,
} from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
export type ModuleType = typeof import('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib')

// Stores the result of the import of the wasm_lib file
let data: ModuleType

// Imports the .js file again which will clear the old import
// This allows us to reinitialize the wasm instance
export async function reloadModule() {
  data = await import(`@rust/kcl-wasm-lib/pkg/kcl_wasm_lib`)
}

export function getModule(): ModuleType {
  return data
}

export async function init(module_or_path: any) {
  return await getModule().default(module_or_path)
}
export const parse_wasm: typeof ParseWasm = (...args) => {
  return getModule().parse_wasm(...args)
}
export const recast_wasm: typeof RecastWasm = (...args) => {
  return getModule().recast_wasm(...args)
}
export const format_number: typeof FormatNumber = (...args) => {
  return getModule().format_number(...args)
}
export const kcl_lint: typeof KclLint = (...args) => {
  return getModule().kcl_lint(...args)
}
export const is_points_ccw: typeof IsPointsCcw = (...args) => {
  return getModule().is_points_ccw(...args)
}
export const get_tangential_arc_to_info: typeof GetTangentialArcToInfo = (
  ...args
) => {
  return getModule().get_tangential_arc_to_info(...args)
}
export const coredump: typeof CoreDump = (...args) => {
  return getModule().coredump(...args)
}
export const default_app_settings: typeof DefaultAppSettings = (...args) => {
  return getModule().default_app_settings(...args)
}
export const parse_app_settings: typeof ParseAppSettings = (...args) => {
  return getModule().parse_app_settings(...args)
}
export const parse_project_settings: typeof ParseProjectSettings = (
  ...args
) => {
  return getModule().parse_project_settings(...args)
}
export const default_project_settings: typeof DefaultProjectSettings = (
  ...args
) => {
  return getModule().default_project_settings(...args)
}
export const base64_decode: typeof Base64Decode = (...args) => {
  return getModule().base64_decode(...args)
}
export const kcl_settings: typeof KclSettings = (...args) => {
  return getModule().kcl_settings(...args)
}
export const change_kcl_settings: typeof ChangeKclSettings = (...args) => {
  return getModule().change_kcl_settings(...args)
}
export const is_kcl_empty_or_only_settings: typeof IsKclEmptyOrOnlySettings = (
  ...args
) => {
  return getModule().is_kcl_empty_or_only_settings(...args)
}
export const get_kcl_version: typeof GetKclVersion = () => {
  return getModule().get_kcl_version()
}
export const serialize_configuration: typeof SerializeConfiguration = (
  ...args
) => {
  return getModule().serialize_configuration(...args)
}
export const serialize_project_configuration: typeof SerializeProjectConfiguration =
  (...args) => {
    return getModule().serialize_project_configuration(...args)
  }
