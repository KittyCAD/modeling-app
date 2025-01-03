/**
 * This wrapper file is to enable reloading of the wasm_lib.js file.
 * When the wasm instance bricks there is no API or interface to restart,
 * restore, or re init the WebAssembly instance. The entire application would need
 * to restart.
 * A way to bypass this is by reloading the entire .js file so the global wasm variable
 * gets reinitialized and we do not use that old reference
 */

type ModuleType = typeof import('../wasm-lib/pkg/wasm_lib')

// Stores the result of the import of the wasm_lib file
let data: ModuleType

// Imports the .js file again which will clear the old import
// This allows us to reinitialize the wasm instance
export async function reloadModule() {
  data = await import(`../wasm-lib/pkg/wasm_lib?version=${Date.now()}`)
}

export function getModule(): ModuleType {
  return data
}

export async function init(module_or_path: any) {
  return await getModule().default(module_or_path)
}
export function parse_wasm(kcl_program_source: string) {
  return getModule().parse_wasm(kcl_program_source)
}
export function recast_wasm(json_str: string) {
  return getModule().recast_wasm(json_str)
}
export function execute(
  program_ast_json: string,
  program_memory_override_str: string,
  settings: string,
  engine_manager: any,
  fs_manager: any
) {
  return getModule().execute(
    program_ast_json,
    program_memory_override_str,
    settings,
    engine_manager,
    fs_manager
  )
}
export function kcl_lint(program_ast_json: string) {
  return getModule().kcl_lint(program_ast_json)
}
export function modify_ast_for_sketch_wasm(
  manager: any,
  program_ast_json: string,
  sketch_name: string,
  plane_type: string,
  sketch_id: string
) {
  return getModule().modify_ast_for_sketch_wasm(
    manager,
    program_ast_json,
    sketch_name,
    plane_type,
    sketch_id
  )
}
export function is_points_ccw(points: Float64Array) {
  return getModule().is_points_ccw(points)
}
export function get_tangential_arc_to_info(
  arc_start_point_x: number,
  arc_start_point_y: number,
  arc_end_point_x: number,
  arc_end_point_y: number,
  tan_previous_point_x: number,
  tan_previous_point_y: number,
  obtuse: boolean
) {
  return getModule().get_tangential_arc_to_info(
    arc_start_point_x,
    arc_start_point_y,
    arc_end_point_x,
    arc_end_point_y,
    tan_previous_point_x,
    tan_previous_point_y,
    obtuse
  )
}
export function program_memory_init() {
  return getModule().program_memory_init()
}
export function make_default_planes(engine_manager: any) {
  return getModule().make_default_planes(engine_manager)
}
export function coredump(core_dump_manager: any) {
  return getModule().coredump(core_dump_manager)
}
export function toml_stringify(json: string) {
  return getModule().toml_stringify(json)
}
export function default_app_settings() {
  return getModule().default_app_settings()
}
export function parse_app_settings(toml_str: string) {
  return getModule().parse_app_settings(toml_str)
}
export function parse_project_settings(toml_str: string) {
  return getModule().parse_project_settings(toml_str)
}
export function default_project_settings() {
  return getModule().default_project_settings()
}
export function base64_decode(input: string) {
  return getModule().base64_decode(input)
}
export function clear_scene_and_bust_cache(engine_manager: any) {
  return getModule().clear_scene_and_bust_cache(engine_manager)
}
