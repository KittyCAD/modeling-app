let data

export async function reloadModule() {
  data = await import(`../wasm-lib/pkg/wasm_lib?version=${Date.now()}`)
}

export function getModule() {
  return data
}

export async function init() {
  return await getModule().default(arguments)
}

export function parse_wasm() {
  return getModule().parse_wasm(...arguments)
}
export function recast_wasm() {
  return getModule().recast_wasm(...arguments)
}
export function execute() {
  return getModule().execute(...arguments)
}
export function kcl_lint() {
  return getModule().kcl_lint(...arguments)
}
export function modify_ast_for_sketch_wasm() {
  return getModule().modify_ast_for_sketch_wasm(...arguments)
}
export function is_points_ccw() {
  return getModule().is_points_ccw(...arguments)
}
export function get_tangential_arc_to_info() {
  return getModule().get_tangential_arc_to_info(...arguments)
}
export function program_memory_init() {
  return getModule().program_memory_init(...arguments)
}
export function make_default_planes() {
  return getModule().make_default_planes(...arguments)
}
export function coredump() {
  return getModule().coredump(...arguments)
}
export function toml_stringify() {
  return getModule().toml_stringify(...arguments)
}
export function default_app_settings() {
  return getModule().default_app_settings(...arguments)
}
export function parse_app_settings() {
  return getModule().parse_app_settings(...arguments)
}
export function parse_project_settings() {
  return getModule().parse_project_settings(...arguments)
}
export function default_project_settings() {
  return getModule().default_project_settings(...arguments)
}
export function base64_decode() {
  return getModule().base64_decode(...arguments)
}
export function clear_scene_and_bust_cache() {
  return getModule().clear_scene_and_bust_cache(...arguments)
}
