/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

type ReadableStreamType = "bytes";

export class Context {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a constraint to sketch.
     */
    add_constraint(version_json: string, sketch_json: string, constraint_json: string, settings: string, create_checkpoint: boolean): Promise<any>;
    add_file(project: number, file: string): Promise<void>;
    /**
     * Add segment to sketch.
     */
    add_segment(version_json: string, sketch_json: string, segment_json: string, label: string | null | undefined, settings: string, create_checkpoint: boolean): Promise<any>;
    /**
     * Reset the scene and bust the cache.
     * ONLY use this if you absolutely need to reset the scene and bust the cache.
     */
    bustCacheAndResetScene(settings: string, path?: string | null): Promise<any>;
    /**
     * Chain a segment to a previous segment by adding it and creating a coincident constraint.
     */
    chain_segment(version_json: string, sketch_json: string, previous_segment_end_point_id_json: string, segment_json: string, label: string | null | undefined, settings: string, create_checkpoint: boolean): Promise<any>;
    clear_sketch_checkpoints(): Promise<void>;
    cloneWithExecuteCallbacks(execution_callbacks: any): Context;
    /**
     * Delete segments and constraints in sketch.
     */
    delete_objects(version_json: string, sketch_json: string, constraint_ids_json: string, segment_ids_json: string, settings: string, create_checkpoint: boolean): Promise<any>;
    /**
     * Delete sketch.
     */
    delete_sketch(version_json: string, sketch_json: string, settings: string): Promise<any>;
    /**
     * Edit a constraint in a sketch.
     */
    edit_constraint(version_json: string, sketch_json: string, constraint_id_json: string, value_expression: string, settings: string, create_checkpoint: boolean): Promise<any>;
    /**
     * Edit a constraint label position in a sketch.
     */
    edit_distance_constraint_label_position(version_json: string, sketch_json: string, constraint_id_json: string, label_position_json: string, settings: string, create_checkpoint: boolean, anchor_segment_ids_json: string, commit_solver_results: boolean): Promise<any>;
    /**
     * Edit segment in sketch.
     */
    edit_segments(version_json: string, sketch_json: string, segments_json: string, settings: string, create_checkpoint: boolean, anchor_segment_ids_json: string, drag_anchors_json: string, commit_solver_results: boolean): Promise<any>;
    /**
     * Enter sketch mode for an existing sketch.
     */
    edit_sketch(project_json: string, file_json: string, version_json: string, sketch_json: string, settings: string): Promise<any>;
    /**
     * Execute a program.
     */
    execute(program_ast_json: string, path: string | null | undefined, settings: string): Promise<any>;
    /**
     * Execute a program in mock mode.
     */
    executeMock(program_ast_json: string, path: string | null | undefined, settings: string, use_prev_memory: boolean): Promise<any>;
    /**
     * Execute trim operations on a sketch.
     * This runs the full trim loop internally, executing all trim operations.
     */
    execute_trim(version_json: string, sketch_json: string, points: Float64Array, settings: string): Promise<any>;
    /**
     * Exit sketch mode.
     */
    exit_sketch(version_json: string, sketch_json: string, settings: string): Promise<any>;
    /**
     * Export a scene to a file.
     */
    export(format_json: string, settings: string): Promise<any>;
    get_file(project_id: number, file_id: number): Promise<any>;
    get_project(project_id: number): Promise<any>;
    /**
     * Set the current program AST and execute it. Temporary hack for
     * development purposes only.
     */
    hack_set_program(program_ast_json: string, settings: string): Promise<any>;
    constructor(engine_manager: any, fs_manager: any, execution_callbacks?: any | null);
    /**
     * Create new sketch and enter sketch mode.
     */
    new_sketch(project_json: string, file_json: string, version_json: string, args_json: string, settings: string): Promise<any>;
    open_project(project: number, files: string, open_file: number): Promise<void>;
    refresh(project: number): Promise<void>;
    remove_file(project: number, file: number): Promise<void>;
    restore_sketch_checkpoint(checkpoint_id_json: string): Promise<any>;
    /**
     * Send a response to kcl lib's engine.
     */
    sendResponse(data: Uint8Array): Promise<void>;
    /**
     * Execute the sketch in mock mode, without changing anything. This is
     * useful after editing segments, and the user releases the mouse button.
     */
    sketch_execute_mock(version_json: string, sketch_json: string, settings: string): Promise<any>;
    switch_file(project: number, file: number): Promise<void>;
    /**
     * Transpile old sketch syntax (startProfile in pipe) to new sketch block syntax.
     *
     * This function re-executes the program using the execution cache (which should be very fast
     * if the program hasn't changed), then extracts the sketch and transpiles it.
     *
     * # Arguments
     * * `program_ast_json` - Program AST as JSON string
     * * `variable_name` - Name of the variable containing the old sketch syntax
     * * `path` - Optional file path for execution context
     * * `settings` - Execution settings as JSON string
     *
     * # Returns
     * The transpiled code as a string, or an error if execution or transpilation fails.
     */
    transpile_old_sketch(program_ast_json: string, variable_name: string, path: string | null | undefined, settings: string): Promise<any>;
    update_file(project: number, file: number, text: string): Promise<void>;
}

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

export class LspServerConfig {
    free(): void;
    [Symbol.dispose](): void;
    constructor(into_server: AsyncIterator<any>, from_server: WritableStream, fs: any);
}

export class ResponseContext {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    send_response(data: Uint8Array): Promise<void>;
}

export class TangentialArcInfoOutputWasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
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

export class WasmCircleParams {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    center_x: number;
    center_y: number;
    radius: number;
}

/**
 * Base64 decode a string.
 */
export function base64_decode(input: string): Uint8Array;

/**
 * Calculate a circle from 3 points.
 */
export function calculate_circle_from_3_points(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): WasmCircleParams;

/**
 * Takes a kcl string and Meta settings and changes the meta settings in the kcl string.
 */
export function change_default_units(code: string, len_str: string): string;

/**
 * Takes a kcl string and Meta settings and changes the meta settings in the kcl string.
 */
export function change_experimental_features(code: string, level_str: string): string;

/**
 * Takes a kcl string and changes the KCL version in the kcl string.
 */
export function change_kcl_version(code: string, version_str: string): string;

/**
 * Get the default app settings.
 */
export function default_app_settings(): any;

/**
 * Get the default project settings.
 */
export function default_project_settings(): any;

export function format_number_literal(value: number, suffix_json: string, decimals?: number | null): string;

export function format_number_value(value: number, numeric_type_json: string): string;

/**
 * Get the version of the kcl library.
 */
export function get_kcl_version(): string;

export function get_tangential_arc_to_info(arc_start_point_x: number, arc_start_point_y: number, arc_end_point_x: number, arc_end_point_y: number, tan_previous_point_x: number, tan_previous_point_y: number, obtuse: boolean): TangentialArcInfoOutputWasm;

export function human_display_number(value: number, ty_json: string): string;

/**
 * Get the allowed import file extensions.
 */
export function import_file_extensions(): string[];

/**
 * Returns true if the given KCL is empty or only contains settings that would
 * be auto-generated.
 */
export function is_kcl_empty_or_only_settings(code: string): any;

export function is_points_ccw(points: Float64Array): number;

export function kcl_lint(program_ast_json: string): Promise<any>;

/**
 * Takes a parsed KCL program and returns the Meta settings.  If it's not
 * found, null is returned.
 */
export function kcl_settings(program_json: string): any;

/**
 * Run the `copilot` lsp server.
 */
export function lsp_run_copilot(config: LspServerConfig, token: string, baseurl: string): Promise<void>;

/**
 * Run the `kcl` lsp server.
 */
export function lsp_run_kcl(config: LspServerConfig, token: string, baseurl: string): Promise<void>;

export function node_path_from_range(program_ast_json: string, range_json: string): Promise<any>;

/**
 * Parse the app settings.
 */
export function parse_app_settings(toml_str: string): any;

/**
 * Parse (deserialize) the project settings.
 */
export function parse_project_settings(toml_str: string): any;

export function parse_wasm(kcl_program_source: string): any;

export function point_to_unit(point_json: string, from_len_unit_json: string, to_len_unit_json: string): Float64Array;

export function recast_wasm(json_str: string): any;

/**
 * Get the allowed relevant file extensions (imports + kcl).
 */
export function relevant_file_extensions(): string[];

/**
 * Serialize the configuration settings.
 */
export function serialize_configuration(val: any): any;

/**
 * Serialize the project configuration settings.
 */
export function serialize_project_configuration(val: any): any;

export function set_kcl_runtime_flags(flags_json: string): void;

export function sketch_checkpoint_limit(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_context_free: (a: number, b: number) => void;
    readonly __wbg_get_tangentialarcinfooutputwasm_arc_length: (a: number) => number;
    readonly __wbg_get_tangentialarcinfooutputwasm_arc_mid_point_x: (a: number) => number;
    readonly __wbg_get_tangentialarcinfooutputwasm_arc_mid_point_y: (a: number) => number;
    readonly __wbg_get_tangentialarcinfooutputwasm_ccw: (a: number) => number;
    readonly __wbg_get_tangentialarcinfooutputwasm_center_x: (a: number) => number;
    readonly __wbg_get_tangentialarcinfooutputwasm_center_y: (a: number) => number;
    readonly __wbg_get_tangentialarcinfooutputwasm_end_angle: (a: number) => number;
    readonly __wbg_get_tangentialarcinfooutputwasm_radius: (a: number) => number;
    readonly __wbg_get_tangentialarcinfooutputwasm_start_angle: (a: number) => number;
    readonly __wbg_set_tangentialarcinfooutputwasm_arc_length: (a: number, b: number) => void;
    readonly __wbg_set_tangentialarcinfooutputwasm_arc_mid_point_x: (a: number, b: number) => void;
    readonly __wbg_set_tangentialarcinfooutputwasm_arc_mid_point_y: (a: number, b: number) => void;
    readonly __wbg_set_tangentialarcinfooutputwasm_ccw: (a: number, b: number) => void;
    readonly __wbg_set_tangentialarcinfooutputwasm_center_x: (a: number, b: number) => void;
    readonly __wbg_set_tangentialarcinfooutputwasm_center_y: (a: number, b: number) => void;
    readonly __wbg_set_tangentialarcinfooutputwasm_end_angle: (a: number, b: number) => void;
    readonly __wbg_set_tangentialarcinfooutputwasm_radius: (a: number, b: number) => void;
    readonly __wbg_set_tangentialarcinfooutputwasm_start_angle: (a: number, b: number) => void;
    readonly __wbg_tangentialarcinfooutputwasm_free: (a: number, b: number) => void;
    readonly __wbg_wasmcircleparams_free: (a: number, b: number) => void;
    readonly base64_decode: (a: number, b: number) => [number, number, number, number];
    readonly calculate_circle_from_3_points: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly change_default_units: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly change_experimental_features: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly change_kcl_version: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly context_bustCacheAndResetScene: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly context_cloneWithExecuteCallbacks: (a: number, b: any) => number;
    readonly context_execute: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly context_executeMock: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
    readonly context_export: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly context_new: (a: any, b: any, c: number) => [number, number, number];
    readonly context_sendResponse: (a: number, b: any) => any;
    readonly default_app_settings: () => [number, number, number];
    readonly default_project_settings: () => [number, number, number];
    readonly format_number_literal: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly format_number_value: (a: number, b: number, c: number) => [number, number, number, number];
    readonly get_kcl_version: () => [number, number];
    readonly get_tangential_arc_to_info: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly human_display_number: (a: number, b: number, c: number) => [number, number, number, number];
    readonly import_file_extensions: () => [number, number, number, number];
    readonly is_kcl_empty_or_only_settings: (a: number, b: number) => [number, number, number];
    readonly is_points_ccw: (a: number, b: number) => number;
    readonly kcl_lint: (a: number, b: number) => any;
    readonly kcl_settings: (a: number, b: number) => [number, number, number];
    readonly node_path_from_range: (a: number, b: number, c: number, d: number) => any;
    readonly parse_app_settings: (a: number, b: number) => [number, number, number];
    readonly parse_project_settings: (a: number, b: number) => [number, number, number];
    readonly parse_wasm: (a: number, b: number) => [number, number, number];
    readonly point_to_unit: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly recast_wasm: (a: number, b: number) => [number, number, number];
    readonly relevant_file_extensions: () => [number, number, number, number];
    readonly serialize_configuration: (a: any) => [number, number, number];
    readonly serialize_project_configuration: (a: any) => [number, number, number];
    readonly set_kcl_runtime_flags: (a: number, b: number) => [number, number];
    readonly __wbg_get_wasmcircleparams_center_x: (a: number) => number;
    readonly __wbg_get_wasmcircleparams_center_y: (a: number) => number;
    readonly __wbg_get_wasmcircleparams_radius: (a: number) => number;
    readonly __wbg_set_wasmcircleparams_center_x: (a: number, b: number) => void;
    readonly __wbg_set_wasmcircleparams_center_y: (a: number, b: number) => void;
    readonly __wbg_set_wasmcircleparams_radius: (a: number, b: number) => void;
    readonly context_add_constraint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => any;
    readonly context_add_file: (a: number, b: number, c: number, d: number) => any;
    readonly context_add_segment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => any;
    readonly context_chain_segment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => any;
    readonly context_clear_sketch_checkpoints: (a: number) => any;
    readonly context_delete_objects: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => any;
    readonly context_delete_sketch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly context_edit_constraint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => any;
    readonly context_edit_distance_constraint_label_position: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => any;
    readonly context_edit_segments: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => any;
    readonly context_edit_sketch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => any;
    readonly context_execute_trim: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly context_exit_sketch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly context_get_file: (a: number, b: number, c: number) => any;
    readonly context_get_project: (a: number, b: number) => any;
    readonly context_hack_set_program: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly context_new_sketch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => any;
    readonly context_open_project: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly context_refresh: (a: number, b: number) => any;
    readonly context_remove_file: (a: number, b: number, c: number) => any;
    readonly context_restore_sketch_checkpoint: (a: number, b: number, c: number) => any;
    readonly context_sketch_execute_mock: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly context_switch_file: (a: number, b: number, c: number) => any;
    readonly context_transpile_old_sketch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly context_update_file: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly sketch_checkpoint_limit: () => number;
    readonly __wbg_lspserverconfig_free: (a: number, b: number) => void;
    readonly lsp_run_copilot: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly lsp_run_kcl: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly lspserverconfig_new: (a: any, b: any, c: any) => number;
    readonly __wbg_responsecontext_free: (a: number, b: number) => void;
    readonly responsecontext_new: () => number;
    readonly responsecontext_send_response: (a: number, b: any) => any;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
    readonly intounderlyingbytesource_start: (a: number, b: any) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly intounderlyingsink_abort: (a: number, b: any) => any;
    readonly intounderlyingsink_close: (a: number) => any;
    readonly intounderlyingsink_write: (a: number, b: any) => any;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: any) => any;
    readonly wasm_bindgen_decc97ac41f959c2___convert__closures_____invoke___wasm_bindgen_decc97ac41f959c2___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_decc97ac41f959c2___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_decc97ac41f959c2___convert__closures_____invoke___js_sys_a54018d7f939c824___IteratorNext__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_decc97ac41f959c2___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_decc97ac41f959c2___convert__closures_____invoke___js_sys_a54018d7f939c824___Function_fn_wasm_bindgen_decc97ac41f959c2___JsValue_____wasm_bindgen_decc97ac41f959c2___sys__Undefined___js_sys_a54018d7f939c824___Function_fn_wasm_bindgen_decc97ac41f959c2___JsValue_____wasm_bindgen_decc97ac41f959c2___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_decc97ac41f959c2___convert__closures_____invoke_______true_: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
