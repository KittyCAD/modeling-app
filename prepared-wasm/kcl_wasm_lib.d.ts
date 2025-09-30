/* tslint:disable */
/* eslint-disable */
export function kcl_lint(program_ast_json: string): Promise<any>
export function node_path_from_range(
  program_ast_json: string,
  range_json: string
): Promise<any>
export function parse_wasm(kcl_program_source: string): any
export function recast_wasm(json_str: string): any
export function format_number_literal(
  value: number,
  suffix_json: string
): string
export function format_number_value(
  value: number,
  numeric_type_json: string
): string
export function human_display_number(value: number, ty_json: string): string
export function is_points_ccw(points: Float64Array): number
export function get_tangential_arc_to_info(
  arc_start_point_x: number,
  arc_start_point_y: number,
  arc_end_point_x: number,
  arc_end_point_y: number,
  tan_previous_point_x: number,
  tan_previous_point_y: number,
  obtuse: boolean
): TangentialArcInfoOutputWasm
/**
 * Get a coredump.
 */
export function coredump(core_dump_manager: any): Promise<any>
/**
 * Get the default app settings.
 */
export function default_app_settings(): any
/**
 * Parse the app settings.
 */
export function parse_app_settings(toml_str: string): any
/**
 * Get the default project settings.
 */
export function default_project_settings(): any
/**
 * Parse (deserialize) the project settings.
 */
export function parse_project_settings(toml_str: string): any
/**
 * Serialize the configuration settings.
 */
export function serialize_configuration(val: any): any
/**
 * Serialize the project configuration settings.
 */
export function serialize_project_configuration(val: any): any
/**
 * Base64 decode a string.
 */
export function base64_decode(input: string): Uint8Array
/**
 * Calculate a circle from 3 points.
 */
export function calculate_circle_from_3_points(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): WasmCircleParams
/**
 * Takes a parsed KCL program and returns the Meta settings.  If it's not
 * found, null is returned.
 */
export function kcl_settings(program_json: string): any
/**
 * Takes a kcl string and Meta settings and changes the meta settings in the kcl string.
 */
export function change_default_units(code: string, len_str: string): string
/**
 * Returns true if the given KCL is empty or only contains settings that would
 * be auto-generated.
 */
export function is_kcl_empty_or_only_settings(code: string): any
/**
 * Get the version of the kcl library.
 */
export function get_kcl_version(): string
/**
 * Get the allowed import file extensions.
 */
export function import_file_extensions(): string[]
/**
 * Get the allowed relevant file extensions (imports + kcl).
 */
export function relevant_file_extensions(): string[]
/**
 * Run the `kcl` lsp server.
 */
export function lsp_run_kcl(
  config: LspServerConfig,
  token: string,
  baseurl: string
): Promise<void>
/**
 * Run the `copilot` lsp server.
 */
export function lsp_run_copilot(
  config: LspServerConfig,
  token: string,
  baseurl: string
): Promise<void>
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */
type ReadableStreamType = 'bytes'
export class Context {
  free(): void
  [Symbol.dispose](): void
  constructor(engine_manager: any, fs_manager: any)
  /**
   * Execute a program.
   */
  execute(
    program_ast_json: string,
    path: string | null | undefined,
    settings: string
  ): Promise<any>
  /**
   * Reset the scene and bust the cache.
   * ONLY use this if you absolutely need to reset the scene and bust the cache.
   */
  bustCacheAndResetScene(settings: string, path?: string | null): Promise<any>
  /**
   * Send a response to kcl lib's engine.
   */
  sendResponse(data: Uint8Array): Promise<void>
  /**
   * Execute a program in mock mode.
   */
  executeMock(
    program_ast_json: string,
    path: string | null | undefined,
    settings: string,
    use_prev_memory: boolean
  ): Promise<any>
  /**
   * Export a scene to a file.
   */
  export(format_json: string, settings: string): Promise<any>
  open_project(project: number, files: string, open_file: number): Promise<void>
  add_file(project: number, file: string): Promise<void>
  remove_file(project: number, file: number): Promise<void>
  update_file(project: number, file: number, text: string): Promise<void>
  switch_file(project: number, file: number): Promise<void>
  refresh(project: number): Promise<void>
}
export class IntoUnderlyingByteSource {
  private constructor()
  free(): void
  [Symbol.dispose](): void
  start(controller: ReadableByteStreamController): void
  pull(controller: ReadableByteStreamController): Promise<any>
  cancel(): void
  readonly type: ReadableStreamType
  readonly autoAllocateChunkSize: number
}
export class IntoUnderlyingSink {
  private constructor()
  free(): void
  [Symbol.dispose](): void
  write(chunk: any): Promise<any>
  close(): Promise<any>
  abort(reason: any): Promise<any>
}
export class IntoUnderlyingSource {
  private constructor()
  free(): void
  [Symbol.dispose](): void
  pull(controller: ReadableStreamDefaultController): Promise<any>
  cancel(): void
}
export class LspServerConfig {
  free(): void
  [Symbol.dispose](): void
  constructor(
    into_server: AsyncIterator<any>,
    from_server: WritableStream,
    fs: any
  )
}
export class ResponseContext {
  free(): void
  [Symbol.dispose](): void
  constructor()
  send_response(data: Uint8Array): Promise<void>
}
export class TangentialArcInfoOutputWasm {
  private constructor()
  free(): void
  [Symbol.dispose](): void
  /**
   * The geometric center of the arc x.
   */
  center_x: number
  /**
   * The geometric center of the arc y.
   */
  center_y: number
  /**
   * The midpoint of the arc x.
   */
  arc_mid_point_x: number
  /**
   * The midpoint of the arc y.
   */
  arc_mid_point_y: number
  /**
   * The radius of the arc.
   */
  radius: number
  /**
   * Start angle of the arc in radians.
   */
  start_angle: number
  /**
   * End angle of the arc in radians.
   */
  end_angle: number
  /**
   * Flag to determine if the arc is counter clockwise.
   */
  ccw: number
  /**
   * The length of the arc.
   */
  arc_length: number
}
export class WasmCircleParams {
  private constructor()
  free(): void
  [Symbol.dispose](): void
  center_x: number
  center_y: number
  radius: number
}

export type InitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module

export interface InitOutput {
  readonly memory: WebAssembly.Memory
  readonly __wbg_context_free: (a: number, b: number) => void
  readonly context_new: (a: any, b: any) => [number, number, number]
  readonly context_execute: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number
  ) => any
  readonly context_bustCacheAndResetScene: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number
  ) => any
  readonly context_sendResponse: (a: number, b: any) => any
  readonly context_executeMock: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number
  ) => any
  readonly context_export: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number
  ) => any
  readonly kcl_lint: (a: number, b: number) => any
  readonly node_path_from_range: (
    a: number,
    b: number,
    c: number,
    d: number
  ) => any
  readonly parse_wasm: (a: number, b: number) => [number, number, number]
  readonly recast_wasm: (a: number, b: number) => [number, number, number]
  readonly format_number_literal: (
    a: number,
    b: number,
    c: number
  ) => [number, number, number, number]
  readonly format_number_value: (
    a: number,
    b: number,
    c: number
  ) => [number, number, number, number]
  readonly human_display_number: (
    a: number,
    b: number,
    c: number
  ) => [number, number, number, number]
  readonly is_points_ccw: (a: number, b: number) => number
  readonly __wbg_tangentialarcinfooutputwasm_free: (
    a: number,
    b: number
  ) => void
  readonly __wbg_get_tangentialarcinfooutputwasm_center_x: (a: number) => number
  readonly __wbg_set_tangentialarcinfooutputwasm_center_x: (
    a: number,
    b: number
  ) => void
  readonly __wbg_get_tangentialarcinfooutputwasm_center_y: (a: number) => number
  readonly __wbg_set_tangentialarcinfooutputwasm_center_y: (
    a: number,
    b: number
  ) => void
  readonly __wbg_get_tangentialarcinfooutputwasm_arc_mid_point_x: (
    a: number
  ) => number
  readonly __wbg_set_tangentialarcinfooutputwasm_arc_mid_point_x: (
    a: number,
    b: number
  ) => void
  readonly __wbg_get_tangentialarcinfooutputwasm_arc_mid_point_y: (
    a: number
  ) => number
  readonly __wbg_set_tangentialarcinfooutputwasm_arc_mid_point_y: (
    a: number,
    b: number
  ) => void
  readonly __wbg_get_tangentialarcinfooutputwasm_radius: (a: number) => number
  readonly __wbg_set_tangentialarcinfooutputwasm_radius: (
    a: number,
    b: number
  ) => void
  readonly __wbg_get_tangentialarcinfooutputwasm_start_angle: (
    a: number
  ) => number
  readonly __wbg_set_tangentialarcinfooutputwasm_start_angle: (
    a: number,
    b: number
  ) => void
  readonly __wbg_get_tangentialarcinfooutputwasm_end_angle: (
    a: number
  ) => number
  readonly __wbg_set_tangentialarcinfooutputwasm_end_angle: (
    a: number,
    b: number
  ) => void
  readonly __wbg_get_tangentialarcinfooutputwasm_ccw: (a: number) => number
  readonly __wbg_set_tangentialarcinfooutputwasm_ccw: (
    a: number,
    b: number
  ) => void
  readonly __wbg_get_tangentialarcinfooutputwasm_arc_length: (
    a: number
  ) => number
  readonly __wbg_set_tangentialarcinfooutputwasm_arc_length: (
    a: number,
    b: number
  ) => void
  readonly get_tangential_arc_to_info: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number
  ) => number
  readonly coredump: (a: any) => any
  readonly default_app_settings: () => [number, number, number]
  readonly parse_app_settings: (
    a: number,
    b: number
  ) => [number, number, number]
  readonly default_project_settings: () => [number, number, number]
  readonly parse_project_settings: (
    a: number,
    b: number
  ) => [number, number, number]
  readonly serialize_configuration: (a: any) => [number, number, number]
  readonly serialize_project_configuration: (a: any) => [number, number, number]
  readonly base64_decode: (
    a: number,
    b: number
  ) => [number, number, number, number]
  readonly __wbg_wasmcircleparams_free: (a: number, b: number) => void
  readonly calculate_circle_from_3_points: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ) => number
  readonly kcl_settings: (a: number, b: number) => [number, number, number]
  readonly change_default_units: (
    a: number,
    b: number,
    c: number,
    d: number
  ) => [number, number, number, number]
  readonly is_kcl_empty_or_only_settings: (
    a: number,
    b: number
  ) => [number, number, number]
  readonly get_kcl_version: () => [number, number]
  readonly import_file_extensions: () => [number, number, number, number]
  readonly relevant_file_extensions: () => [number, number, number, number]
  readonly __wbg_set_wasmcircleparams_center_x: (a: number, b: number) => void
  readonly __wbg_set_wasmcircleparams_center_y: (a: number, b: number) => void
  readonly __wbg_set_wasmcircleparams_radius: (a: number, b: number) => void
  readonly __wbg_get_wasmcircleparams_center_x: (a: number) => number
  readonly __wbg_get_wasmcircleparams_center_y: (a: number) => number
  readonly __wbg_get_wasmcircleparams_radius: (a: number) => number
  readonly context_open_project: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number
  ) => any
  readonly context_add_file: (a: number, b: number, c: number, d: number) => any
  readonly context_remove_file: (a: number, b: number, c: number) => any
  readonly context_update_file: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number
  ) => any
  readonly context_switch_file: (a: number, b: number, c: number) => any
  readonly context_refresh: (a: number, b: number) => any
  readonly __wbg_lspserverconfig_free: (a: number, b: number) => void
  readonly lspserverconfig_new: (a: any, b: any, c: any) => number
  readonly lsp_run_kcl: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number
  ) => any
  readonly lsp_run_copilot: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number
  ) => any
  readonly __wbg_responsecontext_free: (a: number, b: number) => void
  readonly responsecontext_new: () => number
  readonly responsecontext_send_response: (a: number, b: any) => any
  readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void
  readonly intounderlyingsink_write: (a: number, b: any) => any
  readonly intounderlyingsink_close: (a: number) => any
  readonly intounderlyingsink_abort: (a: number, b: any) => any
  readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void
  readonly intounderlyingsource_pull: (a: number, b: any) => any
  readonly intounderlyingsource_cancel: (a: number) => void
  readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void
  readonly intounderlyingbytesource_type: (a: number) => number
  readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number
  readonly intounderlyingbytesource_start: (a: number, b: any) => void
  readonly intounderlyingbytesource_pull: (a: number, b: any) => any
  readonly intounderlyingbytesource_cancel: (a: number) => void
  readonly __wbindgen_exn_store: (a: number) => void
  readonly __externref_table_alloc: () => number
  readonly __wbindgen_export_2: WebAssembly.Table
  readonly __wbindgen_malloc: (a: number, b: number) => number
  readonly __wbindgen_realloc: (
    a: number,
    b: number,
    c: number,
    d: number
  ) => number
  readonly __wbindgen_free: (a: number, b: number, c: number) => void
  readonly __wbindgen_export_6: WebAssembly.Table
  readonly __externref_table_dealloc: (a: number) => void
  readonly __externref_drop_slice: (a: number, b: number) => void
  readonly closure5685_externref_shim: (a: number, b: number, c: any) => void
  readonly wasm_bindgen__convert__closures_____invoke__h36d243168db652d1: (
    a: number,
    b: number
  ) => void
  readonly wasm_bindgen__convert__closures_____invoke__h5607f6709c600671: (
    a: number,
    b: number
  ) => void
  readonly closure6553_externref_shim: (
    a: number,
    b: number,
    c: any,
    d: any
  ) => void
  readonly __wbindgen_start: () => void
}

export type SyncInitInput = BufferSource | WebAssembly.Module
/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(
  module: { module: SyncInitInput } | SyncInitInput
): InitOutput

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>
): Promise<InitOutput>
