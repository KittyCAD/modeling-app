/**
 * This wrapper file is to enable reloading of the wasm_lib.js file.
 * When the wasm instance bricks there is no API or interface to restart,
 * restore, or re init the WebAssembly instance. The entire application would need
 * to restart.
 * A way to bypass this is by reloading the entire .js file so the global wasm variable
 * gets reinitialized and we do not use that old reference
 */

import {
  parse_wasm as ParseWasm,
  recast_wasm as RecastWasm,
  format_number as FormatNumber,
  execute_with_engine as ExecuteWithEngine,
  execute_mock as ExecuteMock,
  kcl_lint as KclLint,
  modify_ast_for_sketch_wasm as ModifyAstForSketch,
  is_points_ccw as IsPointsCcw,
  get_tangential_arc_to_info as GetTangentialArcToInfo,
  make_default_planes as MakeDefaultPlanes,
  coredump as CoreDump,
  toml_stringify as TomlStringify,
  default_app_settings as DefaultAppSettings,
  parse_app_settings as ParseAppSettings,
  parse_project_settings as ParseProjectSettings,
  default_project_settings as DefaultProjectSettings,
  base64_decode as Base64Decode,
  clear_scene_and_bust_cache as ClearSceneAndBustCache,
  kcl_settings as KclSettings,
  change_kcl_settings as ChangeKclSettings,
  get_kcl_version as GetKclVersion,
} from '../wasm-lib/pkg/wasm_lib'

type ModuleType = typeof import('../wasm-lib/pkg/wasm_lib')

// Stores the result of the import of the wasm_lib file
let data: ModuleType

// Imports the .js file again which will clear the old import
// This allows us to reinitialize the wasm instance
export async function reloadModule() {
  data = await import(`../wasm-lib/pkg/wasm_lib`)
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
export const execute_with_engine: typeof ExecuteWithEngine = (...args) => {
  return getModule().execute_with_engine(...args)
}
export const execute_mock: typeof ExecuteMock = (...args) => {
  return getModule().execute_mock(...args)
}
export const kcl_lint: typeof KclLint = (...args) => {
  return getModule().kcl_lint(...args)
}
export const modify_ast_for_sketch_wasm: typeof ModifyAstForSketch = (
  ...args
) => {
  return getModule().modify_ast_for_sketch_wasm(...args)
}
export const is_points_ccw: typeof IsPointsCcw = (...args) => {
  return getModule().is_points_ccw(...args)
}
export const get_tangential_arc_to_info: typeof GetTangentialArcToInfo = (
  ...args
) => {
  return getModule().get_tangential_arc_to_info(...args)
}
export const make_default_planes: typeof MakeDefaultPlanes = (...args) => {
  return getModule().make_default_planes(...args)
}
export const coredump: typeof CoreDump = (...args) => {
  return getModule().coredump(...args)
}
export const toml_stringify: typeof TomlStringify = (...args) => {
  return getModule().toml_stringify(...args)
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
export const clear_scene_and_bust_cache: typeof ClearSceneAndBustCache = (
  ...args
) => {
  return getModule().clear_scene_and_bust_cache(...args)
}
export const kcl_settings: typeof KclSettings = (...args) => {
  return getModule().kcl_settings(...args)
}
export const change_kcl_settings: typeof ChangeKclSettings = (...args) => {
  return getModule().change_kcl_settings(...args)
}
export const get_kcl_version: typeof GetKclVersion = () => {
  return getModule().get_kcl_version()
}
