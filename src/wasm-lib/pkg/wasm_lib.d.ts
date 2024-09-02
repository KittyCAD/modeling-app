/* tslint:disable */
/* eslint-disable */
/**
* @param {string} json
* @returns {string}
*/
export function toml_stringify(json: string): string;
/**
* @param {string} program_str
* @param {string} memory_str
* @param {string} units
* @param {any} engine_manager
* @param {any} fs_manager
* @param {boolean} is_mock
* @returns {Promise<any>}
*/
export function execute_wasm(program_str: string, memory_str: string, units: string, engine_manager: any, fs_manager: any, is_mock: boolean): Promise<any>;
/**
* @param {string} program_str
* @returns {Promise<any>}
*/
export function kcl_lint(program_str: string): Promise<any>;
/**
* @param {any} engine_manager
* @returns {Promise<any>}
*/
export function make_default_planes(engine_manager: any): Promise<any>;
/**
* @param {any} engine_manager
* @param {boolean} hidden
* @returns {Promise<void>}
*/
export function modify_grid(engine_manager: any, hidden: boolean): Promise<void>;
/**
* @param {any} manager
* @param {string} program_str
* @param {string} sketch_name
* @param {string} plane_type
* @param {string} sketch_id
* @returns {Promise<any>}
*/
export function modify_ast_for_sketch_wasm(manager: any, program_str: string, sketch_name: string, plane_type: string, sketch_id: string): Promise<any>;
/**
* @param {Uint8Array} data
* @returns {any}
*/
export function deserialize_files(data: Uint8Array): any;
/**
* @param {string} js
* @returns {any}
*/
export function lexer_wasm(js: string): any;
/**
* @param {string} js
* @returns {any}
*/
export function parse_wasm(js: string): any;
/**
* @param {string} json_str
* @returns {any}
*/
export function recast_wasm(json_str: string): any;
/**
* Run the `kcl` lsp server.
* @param {ServerConfig} config
* @param {any | undefined} engine_manager
* @param {string} units
* @param {string} token
* @param {string} baseurl
* @returns {Promise<void>}
*/
export function kcl_lsp_run(config: ServerConfig, engine_manager: any | undefined, units: string, token: string, baseurl: string): Promise<void>;
/**
* Run the `copilot` lsp server.
* @param {ServerConfig} config
* @param {string} token
* @param {string} baseurl
* @returns {Promise<void>}
*/
export function copilot_lsp_run(config: ServerConfig, token: string, baseurl: string): Promise<void>;
/**
* @param {Float64Array} points
* @returns {number}
*/
export function is_points_ccw(points: Float64Array): number;
/**
* @param {number} arc_start_point_x
* @param {number} arc_start_point_y
* @param {number} arc_end_point_x
* @param {number} arc_end_point_y
* @param {number} tan_previous_point_x
* @param {number} tan_previous_point_y
* @param {boolean} obtuse
* @returns {TangentialArcInfoOutputWasm}
*/
export function get_tangential_arc_to_info(arc_start_point_x: number, arc_start_point_y: number, arc_end_point_x: number, arc_end_point_y: number, tan_previous_point_x: number, tan_previous_point_y: number, obtuse: boolean): TangentialArcInfoOutputWasm;
/**
* Create the default program memory.
* @returns {any}
*/
export function program_memory_init(): any;
/**
* Get a coredump.
* @param {any} core_dump_manager
* @returns {Promise<any>}
*/
export function coredump(core_dump_manager: any): Promise<any>;
/**
* Get the default app settings.
* @returns {any}
*/
export function default_app_settings(): any;
/**
* Parse the app settings.
* @param {string} toml_str
* @returns {any}
*/
export function parse_app_settings(toml_str: string): any;
/**
* Get the default project settings.
* @returns {any}
*/
export function default_project_settings(): any;
/**
* Parse (deserialize) the project settings.
* @param {string} toml_str
* @returns {any}
*/
export function parse_project_settings(toml_str: string): any;
/**
* Serialize the project settings.
* @param {any} val
* @returns {any}
*/
export function serialize_project_settings(val: any): any;
/**
* Base64 decode a string.
* @param {string} input
* @returns {Uint8Array}
*/
export function base64_decode(input: string): Uint8Array;
/**
*/
export class IntoUnderlyingByteSource {
  free(): void;
/**
* @param {ReadableByteStreamController} controller
*/
  start(controller: ReadableByteStreamController): void;
/**
* @param {ReadableByteStreamController} controller
* @returns {Promise<any>}
*/
  pull(controller: ReadableByteStreamController): Promise<any>;
/**
*/
  cancel(): void;
/**
*/
  readonly autoAllocateChunkSize: number;
/**
*/
  readonly type: string;
}
/**
*/
export class IntoUnderlyingSink {
  free(): void;
/**
* @param {any} chunk
* @returns {Promise<any>}
*/
  write(chunk: any): Promise<any>;
/**
* @returns {Promise<any>}
*/
  close(): Promise<any>;
/**
* @param {any} reason
* @returns {Promise<any>}
*/
  abort(reason: any): Promise<any>;
}
/**
*/
export class IntoUnderlyingSource {
  free(): void;
/**
* @param {ReadableStreamDefaultController} controller
* @returns {Promise<any>}
*/
  pull(controller: ReadableStreamDefaultController): Promise<any>;
/**
*/
  cancel(): void;
}
/**
*/
export class ServerConfig {
  free(): void;
/**
* @param {AsyncIterator<any>} into_server
* @param {WritableStream} from_server
* @param {any} fs
*/
  constructor(into_server: AsyncIterator<any>, from_server: WritableStream, fs: any);
}
/**
*/
export class TangentialArcInfoOutputWasm {
  free(): void;
/**
* The length of the arc.
*/
  arc_length: number;
/**
* The midpoint of the arc x.
*/
  arc_mid_point_x: number;
/**
* The midpoint of the arc y.
*/
  arc_mid_point_y: number;
/**
* Flag to determine if the arc is counter clockwise.
*/
  ccw: number;
/**
* The geometric center of the arc x.
*/
  center_x: number;
/**
* The geometric center of the arc y.
*/
  center_y: number;
/**
* End angle of the arc in radians.
*/
  end_angle: number;
/**
* The radius of the arc.
*/
  radius: number;
/**
* Start angle of the arc in radians.
*/
  start_angle: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly toml_stringify: (a: number, b: number, c: number) => void;
  readonly execute_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
  readonly kcl_lint: (a: number, b: number) => number;
  readonly make_default_planes: (a: number) => number;
  readonly modify_grid: (a: number, b: number) => number;
  readonly modify_ast_for_sketch_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
  readonly deserialize_files: (a: number, b: number, c: number) => void;
  readonly lexer_wasm: (a: number, b: number, c: number) => void;
  readonly parse_wasm: (a: number, b: number, c: number) => void;
  readonly recast_wasm: (a: number, b: number, c: number) => void;
  readonly __wbg_serverconfig_free: (a: number) => void;
  readonly serverconfig_new: (a: number, b: number, c: number) => number;
  readonly kcl_lsp_run: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
  readonly copilot_lsp_run: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly is_points_ccw: (a: number, b: number) => number;
  readonly __wbg_tangentialarcinfooutputwasm_free: (a: number) => void;
  readonly __wbg_get_tangentialarcinfooutputwasm_center_x: (a: number) => number;
  readonly __wbg_set_tangentialarcinfooutputwasm_center_x: (a: number, b: number) => void;
  readonly __wbg_get_tangentialarcinfooutputwasm_center_y: (a: number) => number;
  readonly __wbg_set_tangentialarcinfooutputwasm_center_y: (a: number, b: number) => void;
  readonly __wbg_get_tangentialarcinfooutputwasm_arc_mid_point_x: (a: number) => number;
  readonly __wbg_set_tangentialarcinfooutputwasm_arc_mid_point_x: (a: number, b: number) => void;
  readonly __wbg_get_tangentialarcinfooutputwasm_arc_mid_point_y: (a: number) => number;
  readonly __wbg_set_tangentialarcinfooutputwasm_arc_mid_point_y: (a: number, b: number) => void;
  readonly __wbg_get_tangentialarcinfooutputwasm_radius: (a: number) => number;
  readonly __wbg_set_tangentialarcinfooutputwasm_radius: (a: number, b: number) => void;
  readonly __wbg_get_tangentialarcinfooutputwasm_start_angle: (a: number) => number;
  readonly __wbg_set_tangentialarcinfooutputwasm_start_angle: (a: number, b: number) => void;
  readonly __wbg_get_tangentialarcinfooutputwasm_end_angle: (a: number) => number;
  readonly __wbg_set_tangentialarcinfooutputwasm_end_angle: (a: number, b: number) => void;
  readonly __wbg_get_tangentialarcinfooutputwasm_ccw: (a: number) => number;
  readonly __wbg_set_tangentialarcinfooutputwasm_ccw: (a: number, b: number) => void;
  readonly __wbg_get_tangentialarcinfooutputwasm_arc_length: (a: number) => number;
  readonly __wbg_set_tangentialarcinfooutputwasm_arc_length: (a: number, b: number) => void;
  readonly get_tangential_arc_to_info: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly program_memory_init: (a: number) => void;
  readonly coredump: (a: number) => number;
  readonly default_app_settings: (a: number) => void;
  readonly parse_app_settings: (a: number, b: number, c: number) => void;
  readonly default_project_settings: (a: number) => void;
  readonly parse_project_settings: (a: number, b: number, c: number) => void;
  readonly serialize_project_settings: (a: number, b: number) => void;
  readonly base64_decode: (a: number, b: number, c: number) => void;
  readonly __wbg_intounderlyingsource_free: (a: number) => void;
  readonly intounderlyingsource_pull: (a: number, b: number) => number;
  readonly intounderlyingsource_cancel: (a: number) => void;
  readonly __wbg_intounderlyingsink_free: (a: number) => void;
  readonly intounderlyingsink_write: (a: number, b: number) => number;
  readonly intounderlyingsink_close: (a: number) => number;
  readonly intounderlyingsink_abort: (a: number, b: number) => number;
  readonly __wbg_intounderlyingbytesource_free: (a: number) => void;
  readonly intounderlyingbytesource_type: (a: number, b: number) => void;
  readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
  readonly intounderlyingbytesource_start: (a: number, b: number) => void;
  readonly intounderlyingbytesource_pull: (a: number, b: number) => number;
  readonly intounderlyingbytesource_cancel: (a: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly _dyn_core__ops__function__FnMut__A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h441a9e3e174bc8f1: (a: number, b: number, c: number) => void;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly wasm_bindgen__convert__closures__invoke2_mut__h38ba35493531eafd: (a: number, b: number, c: number, d: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {SyncInitInput} module
*
* @returns {InitOutput}
*/
export function initSync(module: SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {InitInput | Promise<InitInput>} module_or_path
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: InitInput | Promise<InitInput>): Promise<InitOutput>;
