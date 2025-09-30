let wasm

let cachedUint8ArrayMemory0 = null

function getUint8ArrayMemory0() {
  if (
    cachedUint8ArrayMemory0 === null ||
    cachedUint8ArrayMemory0.byteLength === 0
  ) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer)
  }
  return cachedUint8ArrayMemory0
}

let cachedTextDecoder = new TextDecoder('utf-8', {
  ignoreBOM: true,
  fatal: true,
})

cachedTextDecoder.decode()

const MAX_SAFARI_DECODE_BYTES = 2146435072
let numBytesDecoded = 0
function decodeText(ptr, len) {
  numBytesDecoded += len
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder('utf-8', {
      ignoreBOM: true,
      fatal: true,
    })
    cachedTextDecoder.decode()
    numBytesDecoded = len
  }
  return cachedTextDecoder.decode(
    getUint8ArrayMemory0().subarray(ptr, ptr + len)
  )
}

function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0
  return decodeText(ptr, len)
}

function addToExternrefTable0(obj) {
  const idx = wasm.__externref_table_alloc()
  wasm.__wbindgen_export_2.set(idx, obj)
  return idx
}

function handleError(f, args) {
  try {
    return f.apply(this, args)
  } catch (e) {
    const idx = addToExternrefTable0(e)
    wasm.__wbindgen_exn_store(idx)
  }
}

let WASM_VECTOR_LEN = 0

const cachedTextEncoder = new TextEncoder()

if (!('encodeInto' in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function (arg, view) {
    const buf = cachedTextEncoder.encode(arg)
    view.set(buf)
    return {
      read: arg.length,
      written: buf.length,
    }
  }
}

function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg)
    const ptr = malloc(buf.length, 1) >>> 0
    getUint8ArrayMemory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf)
    WASM_VECTOR_LEN = buf.length
    return ptr
  }

  let len = arg.length
  let ptr = malloc(len, 1) >>> 0

  const mem = getUint8ArrayMemory0()

  let offset = 0

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset)
    if (code > 0x7f) break
    mem[ptr + offset] = code
  }

  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset)
    }
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len)
    const ret = cachedTextEncoder.encodeInto(arg, view)

    offset += ret.written
    ptr = realloc(ptr, len, offset, 1) >>> 0
  }

  WASM_VECTOR_LEN = offset
  return ptr
}

let cachedDataViewMemory0 = null

function getDataViewMemory0() {
  if (
    cachedDataViewMemory0 === null ||
    cachedDataViewMemory0.buffer.detached === true ||
    (cachedDataViewMemory0.buffer.detached === undefined &&
      cachedDataViewMemory0.buffer !== wasm.memory.buffer)
  ) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer)
  }
  return cachedDataViewMemory0
}

function isLikeNone(x) {
  return x === undefined || x === null
}

function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len)
}

function debugString(val) {
  // primitive types
  const type = typeof val
  if (type == 'number' || type == 'boolean' || val == null) {
    return `${val}`
  }
  if (type == 'string') {
    return `"${val}"`
  }
  if (type == 'symbol') {
    const description = val.description
    if (description == null) {
      return 'Symbol'
    } else {
      return `Symbol(${description})`
    }
  }
  if (type == 'function') {
    const name = val.name
    if (typeof name == 'string' && name.length > 0) {
      return `Function(${name})`
    } else {
      return 'Function'
    }
  }
  // objects
  if (Array.isArray(val)) {
    const length = val.length
    let debug = '['
    if (length > 0) {
      debug += debugString(val[0])
    }
    for (let i = 1; i < length; i++) {
      debug += ', ' + debugString(val[i])
    }
    debug += ']'
    return debug
  }
  // Test for built-in
  const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val))
  let className
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1]
  } else {
    // Failed to match the standard '[object ClassName]'
    return toString.call(val)
  }
  if (className == 'Object') {
    // we're a user defined class or Object
    // JSON.stringify avoids problems with cycles, and is generally much
    // easier than looping through ownProperties of `val`.
    try {
      return 'Object(' + JSON.stringify(val) + ')'
    } catch (_) {
      return 'Object'
    }
  }
  // errors
  if (val instanceof Error) {
    return `${val.name}: ${val.message}\n${val.stack}`
  }
  // TODO we could test for more things here, like `Set`s and `Map`s.
  return className
}

const CLOSURE_DTORS =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((state) => {
        wasm.__wbindgen_export_6.get(state.dtor)(state.a, state.b)
      })

function makeMutClosure(arg0, arg1, dtor, f) {
  const state = { a: arg0, b: arg1, cnt: 1, dtor }
  const real = (...args) => {
    // First up with a closure we increment the internal reference
    // count. This ensures that the Rust closure environment won't
    // be deallocated while we're invoking it.
    state.cnt++
    const a = state.a
    state.a = 0
    try {
      return f(a, state.b, ...args)
    } finally {
      if (--state.cnt === 0) {
        wasm.__wbindgen_export_6.get(state.dtor)(a, state.b)
        CLOSURE_DTORS.unregister(state)
      } else {
        state.a = a
      }
    }
  }
  real.original = state
  CLOSURE_DTORS.register(real, state, state)
  return real
}

function takeFromExternrefTable0(idx) {
  const value = wasm.__wbindgen_export_2.get(idx)
  wasm.__externref_table_dealloc(idx)
  return value
}
/**
 * @param {string} program_ast_json
 * @returns {Promise<any>}
 */
export function kcl_lint(program_ast_json) {
  const ptr0 = passStringToWasm0(
    program_ast_json,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.kcl_lint(ptr0, len0)
  return ret
}

/**
 * @param {string} program_ast_json
 * @param {string} range_json
 * @returns {Promise<any>}
 */
export function node_path_from_range(program_ast_json, range_json) {
  const ptr0 = passStringToWasm0(
    program_ast_json,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len0 = WASM_VECTOR_LEN
  const ptr1 = passStringToWasm0(
    range_json,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len1 = WASM_VECTOR_LEN
  const ret = wasm.node_path_from_range(ptr0, len0, ptr1, len1)
  return ret
}

/**
 * @param {string} kcl_program_source
 * @returns {any}
 */
export function parse_wasm(kcl_program_source) {
  const ptr0 = passStringToWasm0(
    kcl_program_source,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.parse_wasm(ptr0, len0)
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * @param {string} json_str
 * @returns {any}
 */
export function recast_wasm(json_str) {
  const ptr0 = passStringToWasm0(
    json_str,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.recast_wasm(ptr0, len0)
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * @param {number} value
 * @param {string} suffix_json
 * @returns {string}
 */
export function format_number_literal(value, suffix_json) {
  let deferred3_0
  let deferred3_1
  try {
    const ptr0 = passStringToWasm0(
      suffix_json,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    const ret = wasm.format_number_literal(value, ptr0, len0)
    var ptr2 = ret[0]
    var len2 = ret[1]
    if (ret[3]) {
      ptr2 = 0
      len2 = 0
      throw takeFromExternrefTable0(ret[2])
    }
    deferred3_0 = ptr2
    deferred3_1 = len2
    return getStringFromWasm0(ptr2, len2)
  } finally {
    wasm.__wbindgen_free(deferred3_0, deferred3_1, 1)
  }
}

/**
 * @param {number} value
 * @param {string} numeric_type_json
 * @returns {string}
 */
export function format_number_value(value, numeric_type_json) {
  let deferred3_0
  let deferred3_1
  try {
    const ptr0 = passStringToWasm0(
      numeric_type_json,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    const ret = wasm.format_number_value(value, ptr0, len0)
    var ptr2 = ret[0]
    var len2 = ret[1]
    if (ret[3]) {
      ptr2 = 0
      len2 = 0
      throw takeFromExternrefTable0(ret[2])
    }
    deferred3_0 = ptr2
    deferred3_1 = len2
    return getStringFromWasm0(ptr2, len2)
  } finally {
    wasm.__wbindgen_free(deferred3_0, deferred3_1, 1)
  }
}

/**
 * @param {number} value
 * @param {string} ty_json
 * @returns {string}
 */
export function human_display_number(value, ty_json) {
  let deferred3_0
  let deferred3_1
  try {
    const ptr0 = passStringToWasm0(
      ty_json,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    const ret = wasm.human_display_number(value, ptr0, len0)
    var ptr2 = ret[0]
    var len2 = ret[1]
    if (ret[3]) {
      ptr2 = 0
      len2 = 0
      throw takeFromExternrefTable0(ret[2])
    }
    deferred3_0 = ptr2
    deferred3_1 = len2
    return getStringFromWasm0(ptr2, len2)
  } finally {
    wasm.__wbindgen_free(deferred3_0, deferred3_1, 1)
  }
}

let cachedFloat64ArrayMemory0 = null

function getFloat64ArrayMemory0() {
  if (
    cachedFloat64ArrayMemory0 === null ||
    cachedFloat64ArrayMemory0.byteLength === 0
  ) {
    cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer)
  }
  return cachedFloat64ArrayMemory0
}

function passArrayF64ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 8, 8) >>> 0
  getFloat64ArrayMemory0().set(arg, ptr / 8)
  WASM_VECTOR_LEN = arg.length
  return ptr
}
/**
 * @param {Float64Array} points
 * @returns {number}
 */
export function is_points_ccw(points) {
  const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc)
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.is_points_ccw(ptr0, len0)
  return ret
}

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
export function get_tangential_arc_to_info(
  arc_start_point_x,
  arc_start_point_y,
  arc_end_point_x,
  arc_end_point_y,
  tan_previous_point_x,
  tan_previous_point_y,
  obtuse
) {
  const ret = wasm.get_tangential_arc_to_info(
    arc_start_point_x,
    arc_start_point_y,
    arc_end_point_x,
    arc_end_point_y,
    tan_previous_point_x,
    tan_previous_point_y,
    obtuse
  )
  return TangentialArcInfoOutputWasm.__wrap(ret)
}

/**
 * Get a coredump.
 * @param {any} core_dump_manager
 * @returns {Promise<any>}
 */
export function coredump(core_dump_manager) {
  const ret = wasm.coredump(core_dump_manager)
  return ret
}

/**
 * Get the default app settings.
 * @returns {any}
 */
export function default_app_settings() {
  const ret = wasm.default_app_settings()
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * Parse the app settings.
 * @param {string} toml_str
 * @returns {any}
 */
export function parse_app_settings(toml_str) {
  const ptr0 = passStringToWasm0(
    toml_str,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.parse_app_settings(ptr0, len0)
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * Get the default project settings.
 * @returns {any}
 */
export function default_project_settings() {
  const ret = wasm.default_project_settings()
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * Parse (deserialize) the project settings.
 * @param {string} toml_str
 * @returns {any}
 */
export function parse_project_settings(toml_str) {
  const ptr0 = passStringToWasm0(
    toml_str,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.parse_project_settings(ptr0, len0)
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * Serialize the configuration settings.
 * @param {any} val
 * @returns {any}
 */
export function serialize_configuration(val) {
  const ret = wasm.serialize_configuration(val)
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * Serialize the project configuration settings.
 * @param {any} val
 * @returns {any}
 */
export function serialize_project_configuration(val) {
  const ret = wasm.serialize_project_configuration(val)
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * Base64 decode a string.
 * @param {string} input
 * @returns {Uint8Array}
 */
export function base64_decode(input) {
  const ptr0 = passStringToWasm0(
    input,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.base64_decode(ptr0, len0)
  if (ret[3]) {
    throw takeFromExternrefTable0(ret[2])
  }
  var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice()
  wasm.__wbindgen_free(ret[0], ret[1] * 1, 1)
  return v2
}

/**
 * Calculate a circle from 3 points.
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} cx
 * @param {number} cy
 * @returns {WasmCircleParams}
 */
export function calculate_circle_from_3_points(ax, ay, bx, by, cx, cy) {
  const ret = wasm.calculate_circle_from_3_points(ax, ay, bx, by, cx, cy)
  return WasmCircleParams.__wrap(ret)
}

/**
 * Takes a parsed KCL program and returns the Meta settings.  If it's not
 * found, null is returned.
 * @param {string} program_json
 * @returns {any}
 */
export function kcl_settings(program_json) {
  const ptr0 = passStringToWasm0(
    program_json,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.kcl_settings(ptr0, len0)
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * Takes a kcl string and Meta settings and changes the meta settings in the kcl string.
 * @param {string} code
 * @param {string} len_str
 * @returns {string}
 */
export function change_default_units(code, len_str) {
  let deferred4_0
  let deferred4_1
  try {
    const ptr0 = passStringToWasm0(
      code,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(
      len_str,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len1 = WASM_VECTOR_LEN
    const ret = wasm.change_default_units(ptr0, len0, ptr1, len1)
    var ptr3 = ret[0]
    var len3 = ret[1]
    if (ret[3]) {
      ptr3 = 0
      len3 = 0
      throw takeFromExternrefTable0(ret[2])
    }
    deferred4_0 = ptr3
    deferred4_1 = len3
    return getStringFromWasm0(ptr3, len3)
  } finally {
    wasm.__wbindgen_free(deferred4_0, deferred4_1, 1)
  }
}

/**
 * Returns true if the given KCL is empty or only contains settings that would
 * be auto-generated.
 * @param {string} code
 * @returns {any}
 */
export function is_kcl_empty_or_only_settings(code) {
  const ptr0 = passStringToWasm0(
    code,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.is_kcl_empty_or_only_settings(ptr0, len0)
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return takeFromExternrefTable0(ret[0])
}

/**
 * Get the version of the kcl library.
 * @returns {string}
 */
export function get_kcl_version() {
  let deferred1_0
  let deferred1_1
  try {
    const ret = wasm.get_kcl_version()
    deferred1_0 = ret[0]
    deferred1_1 = ret[1]
    return getStringFromWasm0(ret[0], ret[1])
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1)
  }
}

function getArrayJsValueFromWasm0(ptr, len) {
  ptr = ptr >>> 0
  const mem = getDataViewMemory0()
  const result = []
  for (let i = ptr; i < ptr + 4 * len; i += 4) {
    result.push(wasm.__wbindgen_export_2.get(mem.getUint32(i, true)))
  }
  wasm.__externref_drop_slice(ptr, len)
  return result
}
/**
 * Get the allowed import file extensions.
 * @returns {string[]}
 */
export function import_file_extensions() {
  const ret = wasm.import_file_extensions()
  if (ret[3]) {
    throw takeFromExternrefTable0(ret[2])
  }
  var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice()
  wasm.__wbindgen_free(ret[0], ret[1] * 4, 4)
  return v1
}

/**
 * Get the allowed relevant file extensions (imports + kcl).
 * @returns {string[]}
 */
export function relevant_file_extensions() {
  const ret = wasm.relevant_file_extensions()
  if (ret[3]) {
    throw takeFromExternrefTable0(ret[2])
  }
  var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice()
  wasm.__wbindgen_free(ret[0], ret[1] * 4, 4)
  return v1
}

function _assertClass(instance, klass) {
  if (!(instance instanceof klass)) {
    throw new Error(`expected instance of ${klass.name}`)
  }
}
/**
 * Run the `kcl` lsp server.
 * @param {LspServerConfig} config
 * @param {string} token
 * @param {string} baseurl
 * @returns {Promise<void>}
 */
export function lsp_run_kcl(config, token, baseurl) {
  _assertClass(config, LspServerConfig)
  var ptr0 = config.__destroy_into_raw()
  const ptr1 = passStringToWasm0(
    token,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len1 = WASM_VECTOR_LEN
  const ptr2 = passStringToWasm0(
    baseurl,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len2 = WASM_VECTOR_LEN
  const ret = wasm.lsp_run_kcl(ptr0, ptr1, len1, ptr2, len2)
  return ret
}

/**
 * Run the `copilot` lsp server.
 * @param {LspServerConfig} config
 * @param {string} token
 * @param {string} baseurl
 * @returns {Promise<void>}
 */
export function lsp_run_copilot(config, token, baseurl) {
  _assertClass(config, LspServerConfig)
  var ptr0 = config.__destroy_into_raw()
  const ptr1 = passStringToWasm0(
    token,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len1 = WASM_VECTOR_LEN
  const ptr2 = passStringToWasm0(
    baseurl,
    wasm.__wbindgen_malloc,
    wasm.__wbindgen_realloc
  )
  const len2 = WASM_VECTOR_LEN
  const ret = wasm.lsp_run_copilot(ptr0, ptr1, len1, ptr2, len2)
  return ret
}

function __wbg_adapter_8(arg0, arg1, arg2) {
  wasm.closure5685_externref_shim(arg0, arg1, arg2)
}

function __wbg_adapter_11(arg0, arg1) {
  wasm.wasm_bindgen__convert__closures_____invoke__h36d243168db652d1(arg0, arg1)
}

function __wbg_adapter_16(arg0, arg1) {
  wasm.wasm_bindgen__convert__closures_____invoke__h5607f6709c600671(arg0, arg1)
}

function __wbg_adapter_286(arg0, arg1, arg2, arg3) {
  wasm.closure6553_externref_shim(arg0, arg1, arg2, arg3)
}

const __wbindgen_enum_ReadableStreamType = ['bytes']

const __wbindgen_enum_RequestCache = [
  'default',
  'no-store',
  'reload',
  'no-cache',
  'force-cache',
  'only-if-cached',
]

const __wbindgen_enum_RequestCredentials = ['omit', 'same-origin', 'include']

const __wbindgen_enum_RequestMode = [
  'same-origin',
  'no-cors',
  'cors',
  'navigate',
]

const ContextFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_context_free(ptr >>> 0, 1))

export class Context {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    ContextFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_context_free(ptr, 0)
  }
  /**
   * @param {any} engine_manager
   * @param {any} fs_manager
   */
  constructor(engine_manager, fs_manager) {
    const ret = wasm.context_new(engine_manager, fs_manager)
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1])
    }
    this.__wbg_ptr = ret[0] >>> 0
    ContextFinalization.register(this, this.__wbg_ptr, this)
    return this
  }
  /**
   * Execute a program.
   * @param {string} program_ast_json
   * @param {string | null | undefined} path
   * @param {string} settings
   * @returns {Promise<any>}
   */
  execute(program_ast_json, path, settings) {
    const ptr0 = passStringToWasm0(
      program_ast_json,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    var ptr1 = isLikeNone(path)
      ? 0
      : passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    var len1 = WASM_VECTOR_LEN
    const ptr2 = passStringToWasm0(
      settings,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len2 = WASM_VECTOR_LEN
    const ret = wasm.context_execute(
      this.__wbg_ptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2
    )
    return ret
  }
  /**
   * Reset the scene and bust the cache.
   * ONLY use this if you absolutely need to reset the scene and bust the cache.
   * @param {string} settings
   * @param {string | null} [path]
   * @returns {Promise<any>}
   */
  bustCacheAndResetScene(settings, path) {
    const ptr0 = passStringToWasm0(
      settings,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    var ptr1 = isLikeNone(path)
      ? 0
      : passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    var len1 = WASM_VECTOR_LEN
    const ret = wasm.context_bustCacheAndResetScene(
      this.__wbg_ptr,
      ptr0,
      len0,
      ptr1,
      len1
    )
    return ret
  }
  /**
   * Send a response to kcl lib's engine.
   * @param {Uint8Array} data
   * @returns {Promise<void>}
   */
  sendResponse(data) {
    const ret = wasm.context_sendResponse(this.__wbg_ptr, data)
    return ret
  }
  /**
   * Execute a program in mock mode.
   * @param {string} program_ast_json
   * @param {string | null | undefined} path
   * @param {string} settings
   * @param {boolean} use_prev_memory
   * @returns {Promise<any>}
   */
  executeMock(program_ast_json, path, settings, use_prev_memory) {
    const ptr0 = passStringToWasm0(
      program_ast_json,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    var ptr1 = isLikeNone(path)
      ? 0
      : passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    var len1 = WASM_VECTOR_LEN
    const ptr2 = passStringToWasm0(
      settings,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len2 = WASM_VECTOR_LEN
    const ret = wasm.context_executeMock(
      this.__wbg_ptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2,
      use_prev_memory
    )
    return ret
  }
  /**
   * Export a scene to a file.
   * @param {string} format_json
   * @param {string} settings
   * @returns {Promise<any>}
   */
  export(format_json, settings) {
    const ptr0 = passStringToWasm0(
      format_json,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(
      settings,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len1 = WASM_VECTOR_LEN
    const ret = wasm.context_export(this.__wbg_ptr, ptr0, len0, ptr1, len1)
    return ret
  }
  /**
   * @param {number} project
   * @param {string} files
   * @param {number} open_file
   * @returns {Promise<void>}
   */
  open_project(project, files, open_file) {
    const ptr0 = passStringToWasm0(
      files,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    const ret = wasm.context_open_project(
      this.__wbg_ptr,
      project,
      ptr0,
      len0,
      open_file
    )
    return ret
  }
  /**
   * @param {number} project
   * @param {string} file
   * @returns {Promise<void>}
   */
  add_file(project, file) {
    const ptr0 = passStringToWasm0(
      file,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    const ret = wasm.context_add_file(this.__wbg_ptr, project, ptr0, len0)
    return ret
  }
  /**
   * @param {number} project
   * @param {number} file
   * @returns {Promise<void>}
   */
  remove_file(project, file) {
    const ret = wasm.context_remove_file(this.__wbg_ptr, project, file)
    return ret
  }
  /**
   * @param {number} project
   * @param {number} file
   * @param {string} text
   * @returns {Promise<void>}
   */
  update_file(project, file, text) {
    const ptr0 = passStringToWasm0(
      text,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len0 = WASM_VECTOR_LEN
    const ret = wasm.context_update_file(
      this.__wbg_ptr,
      project,
      file,
      ptr0,
      len0
    )
    return ret
  }
  /**
   * @param {number} project
   * @param {number} file
   * @returns {Promise<void>}
   */
  switch_file(project, file) {
    const ret = wasm.context_switch_file(this.__wbg_ptr, project, file)
    return ret
  }
  /**
   * @param {number} project
   * @returns {Promise<void>}
   */
  refresh(project) {
    const ret = wasm.context_refresh(this.__wbg_ptr, project)
    return ret
  }
}
if (Symbol.dispose) Context.prototype[Symbol.dispose] = Context.prototype.free

const IntoUnderlyingByteSourceFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) =>
        wasm.__wbg_intounderlyingbytesource_free(ptr >>> 0, 1)
      )

export class IntoUnderlyingByteSource {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    IntoUnderlyingByteSourceFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_intounderlyingbytesource_free(ptr, 0)
  }
  /**
   * @returns {ReadableStreamType}
   */
  get type() {
    const ret = wasm.intounderlyingbytesource_type(this.__wbg_ptr)
    return __wbindgen_enum_ReadableStreamType[ret]
  }
  /**
   * @returns {number}
   */
  get autoAllocateChunkSize() {
    const ret = wasm.intounderlyingbytesource_autoAllocateChunkSize(
      this.__wbg_ptr
    )
    return ret >>> 0
  }
  /**
   * @param {ReadableByteStreamController} controller
   */
  start(controller) {
    wasm.intounderlyingbytesource_start(this.__wbg_ptr, controller)
  }
  /**
   * @param {ReadableByteStreamController} controller
   * @returns {Promise<any>}
   */
  pull(controller) {
    const ret = wasm.intounderlyingbytesource_pull(this.__wbg_ptr, controller)
    return ret
  }
  cancel() {
    const ptr = this.__destroy_into_raw()
    wasm.intounderlyingbytesource_cancel(ptr)
  }
}
if (Symbol.dispose)
  IntoUnderlyingByteSource.prototype[Symbol.dispose] =
    IntoUnderlyingByteSource.prototype.free

const IntoUnderlyingSinkFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) =>
        wasm.__wbg_intounderlyingsink_free(ptr >>> 0, 1)
      )

export class IntoUnderlyingSink {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    IntoUnderlyingSinkFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_intounderlyingsink_free(ptr, 0)
  }
  /**
   * @param {any} chunk
   * @returns {Promise<any>}
   */
  write(chunk) {
    const ret = wasm.intounderlyingsink_write(this.__wbg_ptr, chunk)
    return ret
  }
  /**
   * @returns {Promise<any>}
   */
  close() {
    const ptr = this.__destroy_into_raw()
    const ret = wasm.intounderlyingsink_close(ptr)
    return ret
  }
  /**
   * @param {any} reason
   * @returns {Promise<any>}
   */
  abort(reason) {
    const ptr = this.__destroy_into_raw()
    const ret = wasm.intounderlyingsink_abort(ptr, reason)
    return ret
  }
}
if (Symbol.dispose)
  IntoUnderlyingSink.prototype[Symbol.dispose] =
    IntoUnderlyingSink.prototype.free

const IntoUnderlyingSourceFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) =>
        wasm.__wbg_intounderlyingsource_free(ptr >>> 0, 1)
      )

export class IntoUnderlyingSource {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    IntoUnderlyingSourceFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_intounderlyingsource_free(ptr, 0)
  }
  /**
   * @param {ReadableStreamDefaultController} controller
   * @returns {Promise<any>}
   */
  pull(controller) {
    const ret = wasm.intounderlyingsource_pull(this.__wbg_ptr, controller)
    return ret
  }
  cancel() {
    const ptr = this.__destroy_into_raw()
    wasm.intounderlyingsource_cancel(ptr)
  }
}
if (Symbol.dispose)
  IntoUnderlyingSource.prototype[Symbol.dispose] =
    IntoUnderlyingSource.prototype.free

const LspServerConfigFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) =>
        wasm.__wbg_lspserverconfig_free(ptr >>> 0, 1)
      )

export class LspServerConfig {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    LspServerConfigFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_lspserverconfig_free(ptr, 0)
  }
  /**
   * @param {AsyncIterator<any>} into_server
   * @param {WritableStream} from_server
   * @param {any} fs
   */
  constructor(into_server, from_server, fs) {
    const ret = wasm.lspserverconfig_new(into_server, from_server, fs)
    this.__wbg_ptr = ret >>> 0
    LspServerConfigFinalization.register(this, this.__wbg_ptr, this)
    return this
  }
}
if (Symbol.dispose)
  LspServerConfig.prototype[Symbol.dispose] = LspServerConfig.prototype.free

const ResponseContextFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) =>
        wasm.__wbg_responsecontext_free(ptr >>> 0, 1)
      )

export class ResponseContext {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    ResponseContextFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_responsecontext_free(ptr, 0)
  }
  constructor() {
    const ret = wasm.responsecontext_new()
    this.__wbg_ptr = ret >>> 0
    ResponseContextFinalization.register(this, this.__wbg_ptr, this)
    return this
  }
  /**
   * @param {Uint8Array} data
   * @returns {Promise<void>}
   */
  send_response(data) {
    const ret = wasm.responsecontext_send_response(this.__wbg_ptr, data)
    return ret
  }
}
if (Symbol.dispose)
  ResponseContext.prototype[Symbol.dispose] = ResponseContext.prototype.free

const TangentialArcInfoOutputWasmFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) =>
        wasm.__wbg_tangentialarcinfooutputwasm_free(ptr >>> 0, 1)
      )

export class TangentialArcInfoOutputWasm {
  static __wrap(ptr) {
    ptr = ptr >>> 0
    const obj = Object.create(TangentialArcInfoOutputWasm.prototype)
    obj.__wbg_ptr = ptr
    TangentialArcInfoOutputWasmFinalization.register(obj, obj.__wbg_ptr, obj)
    return obj
  }

  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    TangentialArcInfoOutputWasmFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_tangentialarcinfooutputwasm_free(ptr, 0)
  }
  /**
   * The geometric center of the arc x.
   * @returns {number}
   */
  get center_x() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_center_x(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * The geometric center of the arc x.
   * @param {number} arg0
   */
  set center_x(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_center_x(this.__wbg_ptr, arg0)
  }
  /**
   * The geometric center of the arc y.
   * @returns {number}
   */
  get center_y() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_center_y(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * The geometric center of the arc y.
   * @param {number} arg0
   */
  set center_y(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_center_y(this.__wbg_ptr, arg0)
  }
  /**
   * The midpoint of the arc x.
   * @returns {number}
   */
  get arc_mid_point_x() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_arc_mid_point_x(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * The midpoint of the arc x.
   * @param {number} arg0
   */
  set arc_mid_point_x(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_arc_mid_point_x(
      this.__wbg_ptr,
      arg0
    )
  }
  /**
   * The midpoint of the arc y.
   * @returns {number}
   */
  get arc_mid_point_y() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_arc_mid_point_y(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * The midpoint of the arc y.
   * @param {number} arg0
   */
  set arc_mid_point_y(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_arc_mid_point_y(
      this.__wbg_ptr,
      arg0
    )
  }
  /**
   * The radius of the arc.
   * @returns {number}
   */
  get radius() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_radius(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * The radius of the arc.
   * @param {number} arg0
   */
  set radius(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_radius(this.__wbg_ptr, arg0)
  }
  /**
   * Start angle of the arc in radians.
   * @returns {number}
   */
  get start_angle() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_start_angle(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * Start angle of the arc in radians.
   * @param {number} arg0
   */
  set start_angle(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_start_angle(this.__wbg_ptr, arg0)
  }
  /**
   * End angle of the arc in radians.
   * @returns {number}
   */
  get end_angle() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_end_angle(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * End angle of the arc in radians.
   * @param {number} arg0
   */
  set end_angle(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_end_angle(this.__wbg_ptr, arg0)
  }
  /**
   * Flag to determine if the arc is counter clockwise.
   * @returns {number}
   */
  get ccw() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_ccw(this.__wbg_ptr)
    return ret
  }
  /**
   * Flag to determine if the arc is counter clockwise.
   * @param {number} arg0
   */
  set ccw(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_ccw(this.__wbg_ptr, arg0)
  }
  /**
   * The length of the arc.
   * @returns {number}
   */
  get arc_length() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_arc_length(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * The length of the arc.
   * @param {number} arg0
   */
  set arc_length(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_arc_length(this.__wbg_ptr, arg0)
  }
}
if (Symbol.dispose)
  TangentialArcInfoOutputWasm.prototype[Symbol.dispose] =
    TangentialArcInfoOutputWasm.prototype.free

const WasmCircleParamsFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) =>
        wasm.__wbg_wasmcircleparams_free(ptr >>> 0, 1)
      )

export class WasmCircleParams {
  static __wrap(ptr) {
    ptr = ptr >>> 0
    const obj = Object.create(WasmCircleParams.prototype)
    obj.__wbg_ptr = ptr
    WasmCircleParamsFinalization.register(obj, obj.__wbg_ptr, obj)
    return obj
  }

  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    WasmCircleParamsFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_wasmcircleparams_free(ptr, 0)
  }
  /**
   * @returns {number}
   */
  get center_x() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_center_x(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * @param {number} arg0
   */
  set center_x(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_center_x(this.__wbg_ptr, arg0)
  }
  /**
   * @returns {number}
   */
  get center_y() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_center_y(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * @param {number} arg0
   */
  set center_y(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_center_y(this.__wbg_ptr, arg0)
  }
  /**
   * @returns {number}
   */
  get radius() {
    const ret = wasm.__wbg_get_tangentialarcinfooutputwasm_arc_mid_point_x(
      this.__wbg_ptr
    )
    return ret
  }
  /**
   * @param {number} arg0
   */
  set radius(arg0) {
    wasm.__wbg_set_tangentialarcinfooutputwasm_arc_mid_point_x(
      this.__wbg_ptr,
      arg0
    )
  }
}
if (Symbol.dispose)
  WasmCircleParams.prototype[Symbol.dispose] = WasmCircleParams.prototype.free

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default'])

async function __wbg_load(module, imports) {
  if (typeof Response === 'function' && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        return await WebAssembly.instantiateStreaming(module, imports)
      } catch (e) {
        const validResponse =
          module.ok && EXPECTED_RESPONSE_TYPES.has(module.type)

        if (
          validResponse &&
          module.headers.get('Content-Type') !== 'application/wasm'
        ) {
          console.warn(
            '`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n',
            e
          )
        } else {
          throw e
        }
      }
    }

    const bytes = await module.arrayBuffer()
    return await WebAssembly.instantiate(bytes, imports)
  } else {
    const instance = await WebAssembly.instantiate(module, imports)

    if (instance instanceof WebAssembly.Instance) {
      return { instance, module }
    } else {
      return instance
    }
  }
}

function __wbg_get_imports() {
  const imports = {}
  imports.wbg = {}
  imports.wbg.__wbg_Error_e17e777aac105295 = function (arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1))
    return ret
  }
  imports.wbg.__wbg_abort_67e1b49bf6614565 = function (arg0) {
    arg0.abort()
  }
  imports.wbg.__wbg_abort_d830bf2e9aa6ec5b = function (arg0, arg1) {
    arg0.abort(arg1)
  }
  imports.wbg.__wbg_append_3527acbfa4288a72 = function () {
    return handleError(function (arg0, arg1, arg2, arg3, arg4) {
      arg0.append(
        getStringFromWasm0(arg1, arg2),
        getStringFromWasm0(arg3, arg4)
      )
    }, arguments)
  }
  imports.wbg.__wbg_append_72a3c0addd2bce38 = function () {
    return handleError(function (arg0, arg1, arg2, arg3, arg4) {
      arg0.append(
        getStringFromWasm0(arg1, arg2),
        getStringFromWasm0(arg3, arg4)
      )
    }, arguments)
  }
  imports.wbg.__wbg_append_be7fb5fa25627b30 = function () {
    return handleError(function (arg0, arg1, arg2, arg3) {
      arg0.append(getStringFromWasm0(arg1, arg2), arg3)
    }, arguments)
  }
  imports.wbg.__wbg_append_e5f17dc5f7227fe7 = function () {
    return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
      arg0.append(
        getStringFromWasm0(arg1, arg2),
        arg3,
        getStringFromWasm0(arg4, arg5)
      )
    }, arguments)
  }
  imports.wbg.__wbg_authToken_d74d721b4e056254 = function () {
    return handleError(function (arg0, arg1) {
      const ret = arg1.authToken()
      const ptr1 = passStringToWasm0(
        ret,
        wasm.__wbindgen_malloc,
        wasm.__wbindgen_realloc
      )
      const len1 = WASM_VECTOR_LEN
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
    }, arguments)
  }
  imports.wbg.__wbg_baseApiUrl_e251be3d24ad4974 = function () {
    return handleError(function (arg0, arg1) {
      const ret = arg1.baseApiUrl()
      const ptr1 = passStringToWasm0(
        ret,
        wasm.__wbindgen_malloc,
        wasm.__wbindgen_realloc
      )
      const len1 = WASM_VECTOR_LEN
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
    }, arguments)
  }
  imports.wbg.__wbg_buffer_8d40b1d762fb3c66 = function (arg0) {
    const ret = arg0.buffer
    return ret
  }
  imports.wbg.__wbg_byobRequest_2c036bceca1e6037 = function (arg0) {
    const ret = arg0.byobRequest
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
  }
  imports.wbg.__wbg_byteLength_331a6b5545834024 = function (arg0) {
    const ret = arg0.byteLength
    return ret
  }
  imports.wbg.__wbg_byteOffset_49a5b5608000358b = function (arg0) {
    const ret = arg0.byteOffset
    return ret
  }
  imports.wbg.__wbg_call_13410aac570ffff7 = function () {
    return handleError(function (arg0, arg1) {
      const ret = arg0.call(arg1)
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_call_a5400b25a865cfd8 = function () {
    return handleError(function (arg0, arg1, arg2) {
      const ret = arg0.call(arg1, arg2)
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_clearTimeout_6222fede17abcb1a = function (arg0) {
    const ret = clearTimeout(arg0)
    return ret
  }
  imports.wbg.__wbg_close_a1918cff3cac355b = function (arg0) {
    const ret = arg0.close()
    return ret
  }
  imports.wbg.__wbg_close_cccada6053ee3a65 = function () {
    return handleError(function (arg0) {
      arg0.close()
    }, arguments)
  }
  imports.wbg.__wbg_close_d71a78219dc23e91 = function () {
    return handleError(function (arg0) {
      arg0.close()
    }, arguments)
  }
  imports.wbg.__wbg_crypto_ed58b8e10a292839 = function (arg0) {
    const ret = arg0.crypto
    return ret
  }
  imports.wbg.__wbg_done_75ed0ee6dd243d9d = function (arg0) {
    const ret = arg0.done
    return ret
  }
  imports.wbg.__wbg_enqueue_452bc2343d1c2ff9 = function () {
    return handleError(function (arg0, arg1) {
      arg0.enqueue(arg1)
    }, arguments)
  }
  imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function (arg0, arg1) {
    let deferred0_0
    let deferred0_1
    try {
      deferred0_0 = arg0
      deferred0_1 = arg1
      console.error(getStringFromWasm0(arg0, arg1))
    } finally {
      wasm.__wbindgen_free(deferred0_0, deferred0_1, 1)
    }
  }
  imports.wbg.__wbg_exists_57b1a9854b76f509 = function () {
    return handleError(function (arg0, arg1, arg2) {
      let deferred0_0
      let deferred0_1
      try {
        deferred0_0 = arg1
        deferred0_1 = arg2
        const ret = arg0.exists(getStringFromWasm0(arg1, arg2))
        return ret
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1)
      }
    }, arguments)
  }
  imports.wbg.__wbg_fetch_87aed7f306ec6d63 = function (arg0, arg1) {
    const ret = arg0.fetch(arg1)
    return ret
  }
  imports.wbg.__wbg_fetch_f156d10be9a5c88a = function (arg0) {
    const ret = fetch(arg0)
    return ret
  }
  imports.wbg.__wbg_fireModelingCommandFromWasm_545e44a7ba6a8283 = function () {
    return handleError(function (
      arg0,
      arg1,
      arg2,
      arg3,
      arg4,
      arg5,
      arg6,
      arg7,
      arg8
    ) {
      let deferred0_0
      let deferred0_1
      let deferred1_0
      let deferred1_1
      let deferred2_0
      let deferred2_1
      let deferred3_0
      let deferred3_1
      try {
        deferred0_0 = arg1
        deferred0_1 = arg2
        deferred1_0 = arg3
        deferred1_1 = arg4
        deferred2_0 = arg5
        deferred2_1 = arg6
        deferred3_0 = arg7
        deferred3_1 = arg8
        arg0.fireModelingCommandFromWasm(
          getStringFromWasm0(arg1, arg2),
          getStringFromWasm0(arg3, arg4),
          getStringFromWasm0(arg5, arg6),
          getStringFromWasm0(arg7, arg8)
        )
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1)
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1)
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1)
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1)
      }
    }, arguments)
  }
  imports.wbg.__wbg_getAllFiles_f8b603edaad206b3 = function () {
    return handleError(function (arg0, arg1, arg2) {
      let deferred0_0
      let deferred0_1
      try {
        deferred0_0 = arg1
        deferred0_1 = arg2
        const ret = arg0.getAllFiles(getStringFromWasm0(arg1, arg2))
        return ret
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1)
      }
    }, arguments)
  }
  imports.wbg.__wbg_getClientState_e92dcb297461ca58 = function () {
    return handleError(function (arg0) {
      const ret = arg0.getClientState()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_getOsInfo_764fa2541c624be3 = function () {
    return handleError(function (arg0, arg1) {
      const ret = arg1.getOsInfo()
      const ptr1 = passStringToWasm0(
        ret,
        wasm.__wbindgen_malloc,
        wasm.__wbindgen_realloc
      )
      const len1 = WASM_VECTOR_LEN
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
    }, arguments)
  }
  imports.wbg.__wbg_getRandomValues_38a1ff1ea09f6cc7 = function () {
    return handleError(function (arg0, arg1) {
      globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1))
    }, arguments)
  }
  imports.wbg.__wbg_getRandomValues_bcb4912f16000dc4 = function () {
    return handleError(function (arg0, arg1) {
      arg0.getRandomValues(arg1)
    }, arguments)
  }
  imports.wbg.__wbg_getTime_6bb3f64e0f18f817 = function (arg0) {
    const ret = arg0.getTime()
    return ret
  }
  imports.wbg.__wbg_getWebrtcStats_b3259e0725b851a2 = function () {
    return handleError(function (arg0) {
      const ret = arg0.getWebrtcStats()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_getWriter_03d7689e275ac6a4 = function () {
    return handleError(function (arg0) {
      const ret = arg0.getWriter()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_get_458e874b43b18b25 = function () {
    return handleError(function (arg0, arg1) {
      const ret = Reflect.get(arg0, arg1)
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_has_b89e451f638123e3 = function () {
    return handleError(function (arg0, arg1) {
      const ret = Reflect.has(arg0, arg1)
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_headers_29fec3c72865cd75 = function (arg0) {
    const ret = arg0.headers
    return ret
  }
  imports.wbg.__wbg_instanceof_Response_50fde2cd696850bf = function (arg0) {
    let result
    try {
      result = arg0 instanceof Response
    } catch (_) {
      result = false
    }
    const ret = result
    return ret
  }
  imports.wbg.__wbg_instanceof_Uint8Array_9a8378d955933db7 = function (arg0) {
    let result
    try {
      result = arg0 instanceof Uint8Array
    } catch (_) {
      result = false
    }
    const ret = result
    return ret
  }
  imports.wbg.__wbg_instanceof_Window_12d20d558ef92592 = function (arg0) {
    let result
    try {
      result = arg0 instanceof Window
    } catch (_) {
      result = false
    }
    const ret = result
    return ret
  }
  imports.wbg.__wbg_instanceof_WorkerGlobalScope_85d487cc157fd065 = function (
    arg0
  ) {
    let result
    try {
      result = arg0 instanceof WorkerGlobalScope
    } catch (_) {
      result = false
    }
    const ret = result
    return ret
  }
  imports.wbg.__wbg_isDesktop_5e2cceb92c02dcc3 = function () {
    return handleError(function (arg0) {
      const ret = arg0.isDesktop()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_iterator_f370b34483c71a1c = function () {
    const ret = Symbol.iterator
    return ret
  }
  imports.wbg.__wbg_kclCode_2648204179f49f6a = function () {
    return handleError(function (arg0, arg1) {
      const ret = arg1.kclCode()
      const ptr1 = passStringToWasm0(
        ret,
        wasm.__wbindgen_malloc,
        wasm.__wbindgen_realloc
      )
      const len1 = WASM_VECTOR_LEN
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
    }, arguments)
  }
  imports.wbg.__wbg_length_6bb7e81f9d7713e4 = function (arg0) {
    const ret = arg0.length
    return ret
  }
  imports.wbg.__wbg_log_6c7b5f4f00b8ce3f = function (arg0) {
    console.log(arg0)
  }
  imports.wbg.__wbg_msCrypto_0a36e2ec3a343d26 = function (arg0) {
    const ret = arg0.msCrypto
    return ret
  }
  imports.wbg.__wbg_new0_b0a0a38c201e6df5 = function () {
    const ret = new Date()
    return ret
  }
  imports.wbg.__wbg_new_19c25a3f2fa63a02 = function () {
    const ret = new Object()
    return ret
  }
  imports.wbg.__wbg_new_1f3a344cf3123716 = function () {
    const ret = new Array()
    return ret
  }
  imports.wbg.__wbg_new_2e3c58a15f39f5f9 = function (arg0, arg1) {
    try {
      var state0 = { a: arg0, b: arg1 }
      var cb0 = (arg0, arg1) => {
        const a = state0.a
        state0.a = 0
        try {
          return __wbg_adapter_286(a, state0.b, arg0, arg1)
        } finally {
          state0.a = a
        }
      }
      const ret = new Promise(cb0)
      return ret
    } finally {
      state0.a = state0.b = 0
    }
  }
  imports.wbg.__wbg_new_5f7466b3e4256d54 = function () {
    return handleError(function () {
      const ret = new FormData()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_new_638ebfaedbf32a5e = function (arg0) {
    const ret = new Uint8Array(arg0)
    return ret
  }
  imports.wbg.__wbg_new_66b9434b4e59b63e = function () {
    return handleError(function () {
      const ret = new AbortController()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_new_8a6f238a6ece86ea = function () {
    const ret = new Error()
    return ret
  }
  imports.wbg.__wbg_new_da9dc54c5db29dfa = function (arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1))
    return ret
  }
  imports.wbg.__wbg_new_f6e53210afea8e45 = function () {
    return handleError(function () {
      const ret = new Headers()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_newfromslice_074c56947bd43469 = function (arg0, arg1) {
    const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1))
    return ret
  }
  imports.wbg.__wbg_newnoargs_254190557c45b4ec = function (arg0, arg1) {
    const ret = new Function(getStringFromWasm0(arg0, arg1))
    return ret
  }
  imports.wbg.__wbg_newwithbyteoffsetandlength_e8f53910b4d42b45 = function (
    arg0,
    arg1,
    arg2
  ) {
    const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0)
    return ret
  }
  imports.wbg.__wbg_newwithlength_a167dcc7aaa3ba77 = function (arg0) {
    const ret = new Uint8Array(arg0 >>> 0)
    return ret
  }
  imports.wbg.__wbg_newwithstrandinit_b5d168a29a3fd85f = function () {
    return handleError(function (arg0, arg1, arg2) {
      const ret = new Request(getStringFromWasm0(arg0, arg1), arg2)
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_newwithu8arraysequenceandoptions_2df1a97d9f42efa4 =
    function () {
      return handleError(function (arg0, arg1) {
        const ret = new Blob(arg0, arg1)
        return ret
      }, arguments)
    }
  imports.wbg.__wbg_next_1142e1658f75ec63 = function () {
    return handleError(function (arg0) {
      const ret = arg0.next()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_next_5b3530e612fde77d = function (arg0) {
    const ret = arg0.next
    return ret
  }
  imports.wbg.__wbg_next_692e82279131b03c = function () {
    return handleError(function (arg0) {
      const ret = arg0.next()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_node_02999533c4ea02e3 = function (arg0) {
    const ret = arg0.node
    return ret
  }
  imports.wbg.__wbg_now_2c95c9de01293173 = function (arg0) {
    const ret = arg0.now()
    return ret
  }
  imports.wbg.__wbg_now_886b39d7ec380719 = function (arg0) {
    const ret = arg0.now()
    return ret
  }
  imports.wbg.__wbg_parse_442f5ba02e5eaf8b = function () {
    return handleError(function (arg0, arg1) {
      const ret = JSON.parse(getStringFromWasm0(arg0, arg1))
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_performance_7a3ffd0b17f663ad = function (arg0) {
    const ret = arg0.performance
    return ret
  }
  imports.wbg.__wbg_pool_9d87711ba49293f2 = function () {
    return handleError(function (arg0, arg1) {
      const ret = arg1.pool()
      const ptr1 = passStringToWasm0(
        ret,
        wasm.__wbindgen_malloc,
        wasm.__wbindgen_realloc
      )
      const len1 = WASM_VECTOR_LEN
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
    }, arguments)
  }
  imports.wbg.__wbg_process_5c1d670bc53614b8 = function (arg0) {
    const ret = arg0.process
    return ret
  }
  imports.wbg.__wbg_prototypesetcall_3d4a26c1ed734349 = function (
    arg0,
    arg1,
    arg2
  ) {
    Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2)
  }
  imports.wbg.__wbg_push_330b2eb93e4e1212 = function (arg0, arg1) {
    const ret = arg0.push(arg1)
    return ret
  }
  imports.wbg.__wbg_queueMicrotask_25d0739ac89e8c88 = function (arg0) {
    queueMicrotask(arg0)
  }
  imports.wbg.__wbg_queueMicrotask_4488407636f5bf24 = function (arg0) {
    const ret = arg0.queueMicrotask
    return ret
  }
  imports.wbg.__wbg_randomFillSync_ab2cfe79ebbf2740 = function () {
    return handleError(function (arg0, arg1) {
      arg0.randomFillSync(arg1)
    }, arguments)
  }
  imports.wbg.__wbg_readFile_62307e6ea4c29fb8 = function () {
    return handleError(function (arg0, arg1, arg2) {
      let deferred0_0
      let deferred0_1
      try {
        deferred0_0 = arg1
        deferred0_1 = arg2
        const ret = arg0.readFile(getStringFromWasm0(arg1, arg2))
        return ret
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1)
      }
    }, arguments)
  }
  imports.wbg.__wbg_ready_4186da3cb500ae7d = function (arg0) {
    const ret = arg0.ready
    return ret
  }
  imports.wbg.__wbg_releaseLock_62151472ae632176 = function (arg0) {
    arg0.releaseLock()
  }
  imports.wbg.__wbg_require_79b1e9274cde3c87 = function () {
    return handleError(function () {
      const ret = module.require
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_resolve_4055c623acdd6a1b = function (arg0) {
    const ret = Promise.resolve(arg0)
    return ret
  }
  imports.wbg.__wbg_respond_6c2c4e20ef85138e = function () {
    return handleError(function (arg0, arg1) {
      arg0.respond(arg1 >>> 0)
    }, arguments)
  }
  imports.wbg.__wbg_screenshot_6593b4eef47e7b50 = function () {
    return handleError(function (arg0) {
      const ret = arg0.screenshot()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_sendModelingCommandFromWasm_350f9b4116945c34 = function () {
    return handleError(function (
      arg0,
      arg1,
      arg2,
      arg3,
      arg4,
      arg5,
      arg6,
      arg7,
      arg8
    ) {
      let deferred0_0
      let deferred0_1
      let deferred1_0
      let deferred1_1
      let deferred2_0
      let deferred2_1
      let deferred3_0
      let deferred3_1
      try {
        deferred0_0 = arg1
        deferred0_1 = arg2
        deferred1_0 = arg3
        deferred1_1 = arg4
        deferred2_0 = arg5
        deferred2_1 = arg6
        deferred3_0 = arg7
        deferred3_1 = arg8
        const ret = arg0.sendModelingCommandFromWasm(
          getStringFromWasm0(arg1, arg2),
          getStringFromWasm0(arg3, arg4),
          getStringFromWasm0(arg5, arg6),
          getStringFromWasm0(arg7, arg8)
        )
        return ret
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1)
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1)
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1)
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1)
      }
    }, arguments)
  }
  imports.wbg.__wbg_setTimeout_2966518f28aef92e = function () {
    return handleError(function (arg0, arg1, arg2) {
      const ret = arg0.setTimeout(arg1, arg2)
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_setTimeout_2b339866a2aa3789 = function (arg0, arg1) {
    const ret = setTimeout(arg0, arg1)
    return ret
  }
  imports.wbg.__wbg_setTimeout_98aff77124ecfa08 = function () {
    return handleError(function (arg0, arg1, arg2) {
      const ret = arg0.setTimeout(arg1, arg2)
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_set_1353b2a5e96bc48c = function (arg0, arg1, arg2) {
    arg0.set(getArrayU8FromWasm0(arg1, arg2))
  }
  imports.wbg.__wbg_setbody_c8460bdf44147df8 = function (arg0, arg1) {
    arg0.body = arg1
  }
  imports.wbg.__wbg_setcache_90ca4ad8a8ad40d3 = function (arg0, arg1) {
    arg0.cache = __wbindgen_enum_RequestCache[arg1]
  }
  imports.wbg.__wbg_setcredentials_9cd60d632c9d5dfc = function (arg0, arg1) {
    arg0.credentials = __wbindgen_enum_RequestCredentials[arg1]
  }
  imports.wbg.__wbg_setheaders_0052283e2f3503d1 = function (arg0, arg1) {
    arg0.headers = arg1
  }
  imports.wbg.__wbg_setmethod_9b504d5b855b329c = function (arg0, arg1, arg2) {
    arg0.method = getStringFromWasm0(arg1, arg2)
  }
  imports.wbg.__wbg_setmode_a23e1a2ad8b512f8 = function (arg0, arg1) {
    arg0.mode = __wbindgen_enum_RequestMode[arg1]
  }
  imports.wbg.__wbg_setsignal_8c45ad1247a74809 = function (arg0, arg1) {
    arg0.signal = arg1
  }
  imports.wbg.__wbg_settype_298968e371b58a33 = function (arg0, arg1, arg2) {
    arg0.type = getStringFromWasm0(arg1, arg2)
  }
  imports.wbg.__wbg_signal_da4d466ce86118b5 = function (arg0) {
    const ret = arg0.signal
    return ret
  }
  imports.wbg.__wbg_stack_0ed75d68575b0f3c = function (arg0, arg1) {
    const ret = arg1.stack
    const ptr1 = passStringToWasm0(
      ret,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len1 = WASM_VECTOR_LEN
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
  }
  imports.wbg.__wbg_startNewSession_a65d0993e1ad4a69 = function () {
    return handleError(function (arg0) {
      const ret = arg0.startNewSession()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_static_accessor_GLOBAL_8921f820c2ce3f12 = function () {
    const ret = typeof global === 'undefined' ? null : global
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
  }
  imports.wbg.__wbg_static_accessor_GLOBAL_THIS_f0a4409105898184 = function () {
    const ret = typeof globalThis === 'undefined' ? null : globalThis
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
  }
  imports.wbg.__wbg_static_accessor_SELF_995b214ae681ff99 = function () {
    const ret = typeof self === 'undefined' ? null : self
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
  }
  imports.wbg.__wbg_static_accessor_WINDOW_cde3890479c675ea = function () {
    const ret = typeof window === 'undefined' ? null : window
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
  }
  imports.wbg.__wbg_status_3fea3036088621d6 = function (arg0) {
    const ret = arg0.status
    return ret
  }
  imports.wbg.__wbg_stringify_b98c93d0a190446a = function () {
    return handleError(function (arg0) {
      const ret = JSON.stringify(arg0)
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_subarray_70fd07feefe14294 = function (arg0, arg1, arg2) {
    const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0)
    return ret
  }
  imports.wbg.__wbg_text_0f69a215637b9b34 = function () {
    return handleError(function (arg0) {
      const ret = arg0.text()
      return ret
    }, arguments)
  }
  imports.wbg.__wbg_then_b33a773d723afa3e = function (arg0, arg1, arg2) {
    const ret = arg0.then(arg1, arg2)
    return ret
  }
  imports.wbg.__wbg_then_e22500defe16819f = function (arg0, arg1) {
    const ret = arg0.then(arg1)
    return ret
  }
  imports.wbg.__wbg_toString_78df35411a4fd40c = function (arg0) {
    const ret = arg0.toString()
    return ret
  }
  imports.wbg.__wbg_toString_d8f537919ef401d6 = function (arg0) {
    const ret = arg0.toString()
    return ret
  }
  imports.wbg.__wbg_url_e5720dfacf77b05e = function (arg0, arg1) {
    const ret = arg1.url
    const ptr1 = passStringToWasm0(
      ret,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len1 = WASM_VECTOR_LEN
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
  }
  imports.wbg.__wbg_value_dd9372230531eade = function (arg0) {
    const ret = arg0.value
    return ret
  }
  imports.wbg.__wbg_version_3dea5eee6219186c = function () {
    return handleError(function (arg0, arg1) {
      const ret = arg1.version()
      const ptr1 = passStringToWasm0(
        ret,
        wasm.__wbindgen_malloc,
        wasm.__wbindgen_realloc
      )
      const len1 = WASM_VECTOR_LEN
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
    }, arguments)
  }
  imports.wbg.__wbg_versions_c71aa1626a93e0a1 = function (arg0) {
    const ret = arg0.versions
    return ret
  }
  imports.wbg.__wbg_view_91cc97d57ab30530 = function (arg0) {
    const ret = arg0.view
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
  }
  imports.wbg.__wbg_warn_e2ada06313f92f09 = function (arg0) {
    console.warn(arg0)
  }
  imports.wbg.__wbg_wbindgenbooleanget_3fe6f642c7d97746 = function (arg0) {
    const v = arg0
    const ret = typeof v === 'boolean' ? v : undefined
    return isLikeNone(ret) ? 0xffffff : ret ? 1 : 0
  }
  imports.wbg.__wbg_wbindgencbdrop_eb10308566512b88 = function (arg0) {
    const obj = arg0.original
    if (obj.cnt-- == 1) {
      obj.a = 0
      return true
    }
    const ret = false
    return ret
  }
  imports.wbg.__wbg_wbindgendebugstring_99ef257a3ddda34d = function (
    arg0,
    arg1
  ) {
    const ret = debugString(arg1)
    const ptr1 = passStringToWasm0(
      ret,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc
    )
    const len1 = WASM_VECTOR_LEN
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
  }
  imports.wbg.__wbg_wbindgenisfunction_8cee7dce3725ae74 = function (arg0) {
    const ret = typeof arg0 === 'function'
    return ret
  }
  imports.wbg.__wbg_wbindgenisnull_f3037694abe4d97a = function (arg0) {
    const ret = arg0 === null
    return ret
  }
  imports.wbg.__wbg_wbindgenisobject_307a53c6bd97fbf8 = function (arg0) {
    const val = arg0
    const ret = typeof val === 'object' && val !== null
    return ret
  }
  imports.wbg.__wbg_wbindgenisstring_d4fa939789f003b0 = function (arg0) {
    const ret = typeof arg0 === 'string'
    return ret
  }
  imports.wbg.__wbg_wbindgenisundefined_c4b71d073b92f3c5 = function (arg0) {
    const ret = arg0 === undefined
    return ret
  }
  imports.wbg.__wbg_wbindgenstringget_0f16a6ddddef376f = function (arg0, arg1) {
    const obj = arg1
    const ret = typeof obj === 'string' ? obj : undefined
    var ptr1 = isLikeNone(ret)
      ? 0
      : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    var len1 = WASM_VECTOR_LEN
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
  }
  imports.wbg.__wbg_wbindgenthrow_451ec1a8469d7eb6 = function (arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1))
  }
  imports.wbg.__wbg_write_2e39e04a4c8c9e9d = function (arg0, arg1) {
    const ret = arg0.write(arg1)
    return ret
  }
  imports.wbg.__wbindgen_cast_21b0dc5e617e0ef2 = function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 5603, function: Function { arguments: [], shim_idx: 5604, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, 5603, __wbg_adapter_16)
    return ret
  }
  imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function (arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1)
    return ret
  }
  imports.wbg.__wbindgen_cast_4b23d6a591977186 = function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 5214, function: Function { arguments: [], shim_idx: 5215, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, 5214, __wbg_adapter_11)
    return ret
  }
  imports.wbg.__wbindgen_cast_5dbfd119defee0ff = function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 5684, function: Function { arguments: [Externref], shim_idx: 5685, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, 5684, __wbg_adapter_8)
    return ret
  }
  imports.wbg.__wbindgen_cast_cb9088102bce6b30 = function (arg0, arg1) {
    // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
    const ret = getArrayU8FromWasm0(arg0, arg1)
    return ret
  }
  imports.wbg.__wbindgen_init_externref_table = function () {
    const table = wasm.__wbindgen_export_2
    const offset = table.grow(4)
    table.set(0, undefined)
    table.set(offset + 0, undefined)
    table.set(offset + 1, null)
    table.set(offset + 2, true)
    table.set(offset + 3, false)
  }

  return imports
}

function __wbg_init_memory(imports, memory) {}

function __wbg_finalize_init(instance, module) {
  wasm = instance.exports
  __wbg_init.__wbindgen_wasm_module = module
  cachedDataViewMemory0 = null
  cachedFloat64ArrayMemory0 = null
  cachedUint8ArrayMemory0 = null

  wasm.__wbindgen_start()
  return wasm
}

function initSync(module) {
  if (wasm !== undefined) return wasm

  if (typeof module !== 'undefined') {
    if (Object.getPrototypeOf(module) === Object.prototype) {
      ;({ module } = module)
    } else {
      console.warn(
        'using deprecated parameters for `initSync()`; pass a single object instead'
      )
    }
  }

  const imports = __wbg_get_imports()

  __wbg_init_memory(imports)

  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module)
  }

  const instance = new WebAssembly.Instance(module, imports)

  return __wbg_finalize_init(instance, module)
}

async function __wbg_init(module_or_path) {
  if (wasm !== undefined) return wasm

  if (typeof module_or_path !== 'undefined') {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ;({ module_or_path } = module_or_path)
    } else {
      console.warn(
        'using deprecated parameters for the initialization function; pass a single object instead'
      )
    }
  }

  if (typeof module_or_path === 'undefined') {
    module_or_path = new URL('kcl_wasm_lib_bg.wasm', import.meta.url)
  }
  const imports = __wbg_get_imports()

  if (
    typeof module_or_path === 'string' ||
    (typeof Request === 'function' && module_or_path instanceof Request) ||
    (typeof URL === 'function' && module_or_path instanceof URL)
  ) {
    module_or_path = fetch(module_or_path)
  }

  __wbg_init_memory(imports)

  const { instance, module } = await __wbg_load(await module_or_path, imports)

  return __wbg_finalize_init(instance, module)
}

export { initSync }
export default __wbg_init
