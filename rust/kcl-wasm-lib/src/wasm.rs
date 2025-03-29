//! Wasm bindings for `kcl`.

use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::{pretty::NumericSuffix, CoreDump, Point2d, Program};
use wasm_bindgen::prelude::*;

// wasm_bindgen wrapper for execute
#[wasm_bindgen]
pub async fn kcl_lint(program_ast_json: &str) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let program: Program = serde_json::from_str(program_ast_json).map_err(|e| e.to_string())?;
    let mut findings = vec![];
    for discovered_finding in program.lint_all().into_iter().flatten() {
        findings.push(discovered_finding);
    }

    Ok(JsValue::from_serde(&findings).map_err(|e| e.to_string())?)
}

#[wasm_bindgen]
pub fn parse_wasm(kcl_program_source: &str) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let (program, errs) = Program::parse(kcl_program_source).map_err(String::from)?;
    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&(program, errs)).map_err(|e| e.to_string())
}

// wasm_bindgen wrapper for recast
// test for this function and by extension the recaster are done in javascript land src/lang/recast.test.ts
#[wasm_bindgen]
pub fn recast_wasm(json_str: &str) -> Result<JsValue, JsError> {
    console_error_panic_hook::set_once();

    let program: Program = serde_json::from_str(json_str).map_err(JsError::from)?;
    Ok(JsValue::from_serde(&program.recast())?)
}

#[wasm_bindgen]
pub fn format_number(value: f64, suffix_json: &str) -> Result<String, JsError> {
    console_error_panic_hook::set_once();

    let suffix: NumericSuffix = serde_json::from_str(suffix_json).map_err(JsError::from)?;
    Ok(kcl_lib::pretty::format_number(value, suffix))
}

#[wasm_bindgen]
pub fn is_points_ccw(points: &[f64]) -> i32 {
    console_error_panic_hook::set_once();

    kcl_lib::std_utils::is_points_ccw_wasm(points)
}

#[wasm_bindgen]
pub struct TangentialArcInfoOutputWasm {
    /// The geometric center of the arc x.
    pub center_x: f64,
    /// The geometric center of the arc y.
    pub center_y: f64,
    /// The midpoint of the arc x.
    pub arc_mid_point_x: f64,
    /// The midpoint of the arc y.
    pub arc_mid_point_y: f64,
    /// The radius of the arc.
    pub radius: f64,
    /// Start angle of the arc in radians.
    pub start_angle: f64,
    /// End angle of the arc in radians.
    pub end_angle: f64,
    /// Flag to determine if the arc is counter clockwise.
    pub ccw: i32,
    /// The length of the arc.
    pub arc_length: f64,
}

#[wasm_bindgen]
pub fn get_tangential_arc_to_info(
    arc_start_point_x: f64,
    arc_start_point_y: f64,
    arc_end_point_x: f64,
    arc_end_point_y: f64,
    tan_previous_point_x: f64,
    tan_previous_point_y: f64,
    obtuse: bool,
) -> TangentialArcInfoOutputWasm {
    console_error_panic_hook::set_once();

    let result = kcl_lib::std_utils::get_tangential_arc_to_info(kcl_lib::std_utils::TangentialArcInfoInput {
        arc_start_point: [arc_start_point_x, arc_start_point_y],
        arc_end_point: [arc_end_point_x, arc_end_point_y],
        tan_previous_point: [tan_previous_point_x, tan_previous_point_y],
        obtuse,
    });
    TangentialArcInfoOutputWasm {
        center_x: result.center[0],
        center_y: result.center[1],
        arc_mid_point_x: result.arc_mid_point[0],
        arc_mid_point_y: result.arc_mid_point[1],
        radius: result.radius,
        start_angle: result.start_angle,
        end_angle: result.end_angle,
        ccw: result.ccw,
        arc_length: result.arc_length,
    }
}

/// Get a coredump.
#[wasm_bindgen]
pub async fn coredump(core_dump_manager: kcl_lib::wasm_engine::CoreDumpManager) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let core_dumper = kcl_lib::wasm_engine::CoreDumper::new(core_dump_manager);
    let dump = core_dumper.dump().await.map_err(|e| e.to_string())?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&dump).map_err(|e| e.to_string())
}

/// Get the default app settings.
#[wasm_bindgen]
pub fn default_app_settings() -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let settings = kcl_lib::Configuration::default();

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&settings).map_err(|e| e.to_string())
}

/// Parse the app settings.
#[wasm_bindgen]
pub fn parse_app_settings(toml_str: &str) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let settings = kcl_lib::Configuration::backwards_compatible_toml_parse(toml_str).map_err(|e| e.to_string())?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&settings).map_err(|e| e.to_string())
}

/// Get the default project settings.
#[wasm_bindgen]
pub fn default_project_settings() -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let settings = kcl_lib::ProjectConfiguration::default();

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&settings).map_err(|e| e.to_string())
}

/// Parse (deserialize) the project settings.
#[wasm_bindgen]
pub fn parse_project_settings(toml_str: &str) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let settings =
        kcl_lib::ProjectConfiguration::backwards_compatible_toml_parse(toml_str).map_err(|e| e.to_string())?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&settings).map_err(|e| e.to_string())
}

/// Serialize the configuration settings.
#[wasm_bindgen]
pub fn serialize_configuration(val: JsValue) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let config: kcl_lib::Configuration = val.into_serde().map_err(|e| e.to_string())?;

    let toml_str = toml::to_string_pretty(&config).map_err(|e| e.to_string())?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    Ok(JsValue::from_str(&toml_str))
}

/// Serialize the project configuration settings.
#[wasm_bindgen]
pub fn serialize_project_configuration(val: JsValue) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let config: kcl_lib::ProjectConfiguration = val.into_serde().map_err(|e| e.to_string())?;

    let toml_str = toml::to_string_pretty(&config).map_err(|e| e.to_string())?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    Ok(JsValue::from_str(&toml_str))
}

static ALLOWED_DECODING_FORMATS: &[data_encoding::Encoding] = &[
    data_encoding::BASE64,
    data_encoding::BASE64URL,
    data_encoding::BASE64URL_NOPAD,
    data_encoding::BASE64_MIME,
    data_encoding::BASE64_NOPAD,
];

/// Base64 decode a string.
#[wasm_bindgen]
pub fn base64_decode(input: &str) -> Result<Vec<u8>, JsValue> {
    console_error_panic_hook::set_once();

    // Forgive alt base64 decoding formats
    for config in ALLOWED_DECODING_FORMATS {
        if let Ok(data) = config.decode(input.as_bytes()) {
            return Ok(data);
        }
    }

    Err(JsValue::from_str("Invalid base64 encoding"))
}

#[wasm_bindgen]
pub struct WasmCircleParams {
    pub center_x: f64,
    pub center_y: f64,
    pub radius: f64,
}

/// Calculate a circle from 3 points.
#[wasm_bindgen]
pub fn calculate_circle_from_3_points(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> WasmCircleParams {
    let result = kcl_lib::std::utils::calculate_circle_from_3_points([
        Point2d { x: ax, y: ay },
        Point2d { x: bx, y: by },
        Point2d { x: cx, y: cy },
    ]);

    WasmCircleParams {
        center_x: result.center.x,
        center_y: result.center.y,
        radius: result.radius,
    }
}

/// Takes a parsed KCL program and returns the Meta settings.  If it's not
/// found, null is returned.
#[wasm_bindgen]
pub fn kcl_settings(program_json: &str) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let program: Program = serde_json::from_str(program_json).map_err(|e| e.to_string())?;
    let settings = program.meta_settings().map_err(|e| e.to_string())?;

    JsValue::from_serde(&settings).map_err(|e| e.to_string())
}

/// Takes a kcl string and Meta settings and changes the meta settings in the kcl string.
#[wasm_bindgen]
pub fn change_kcl_settings(code: &str, settings_str: &str) -> Result<String, String> {
    console_error_panic_hook::set_once();

    let settings: kcl_lib::MetaSettings = serde_json::from_str(settings_str).map_err(|e| e.to_string())?;
    let program = Program::parse_no_errs(code).map_err(|e| e.to_string())?;

    let new_program = program.change_meta_settings(settings).map_err(|e| e.to_string())?;

    let formatted = new_program.recast();

    Ok(formatted)
}

/// Returns true if the given KCL is empty or only contains settings that would
/// be auto-generated.
#[wasm_bindgen]
pub fn is_kcl_empty_or_only_settings(code: &str) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let program = Program::parse_no_errs(code).map_err(|e| e.to_string())?;

    JsValue::from_serde(&program.is_empty_or_only_settings()).map_err(|e| e.to_string())
}

/// Get the version of the kcl library.
#[wasm_bindgen]
pub fn get_kcl_version() -> String {
    console_error_panic_hook::set_once();

    kcl_lib::version().to_string()
}
