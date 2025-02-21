//! Wasm bindings for `kcl`.

use std::sync::Arc;

use futures::stream::TryStreamExt;
use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::{
    bust_cache, clear_mem_cache, exec::IdGenerator, pretty::NumericSuffix, CoreDump, EngineManager, ModuleId, Point2d,
    Program,
};
use tower_lsp::{LspService, Server};
use wasm_bindgen::prelude::*;

// wasm_bindgen wrapper for clearing the scene and busting the cache.
#[wasm_bindgen]
pub async fn clear_scene_and_bust_cache(
    engine_manager: kcl_lib::wasm_engine::EngineCommandManager,
) -> Result<(), String> {
    console_error_panic_hook::set_once();

    bust_cache().await;
    clear_mem_cache().await;

    let engine = kcl_lib::wasm_engine::EngineConnection::new(engine_manager)
        .await
        .map_err(|e| format!("{:?}", e))?;

    let mut id_generator: IdGenerator = Default::default();
    engine
        .clear_scene(&mut id_generator, Default::default())
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// wasm_bindgen wrapper for execute
#[wasm_bindgen]
pub async fn execute_with_engine(
    program_ast_json: &str,
    path: Option<String>,
    settings: &str,
    engine_manager: kcl_lib::wasm_engine::EngineCommandManager,
    fs_manager: kcl_lib::wasm_engine::FileSystemManager,
) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let program: Program = serde_json::from_str(program_ast_json).map_err(|e| e.to_string())?;
    let config: kcl_lib::Configuration = serde_json::from_str(settings).map_err(|e| e.to_string())?;
    let mut settings: kcl_lib::ExecutorSettings = config.into();
    if let Some(path) = path {
        settings.with_current_file(std::path::PathBuf::from(path));
    }

    let ctx = kcl_lib::ExecutorContext::new(engine_manager, fs_manager, settings.into()).await?;
    match ctx.run_with_caching(program).await {
        // The serde-wasm-bindgen does not work here because of weird HashMap issues.
        // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
        Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
        Err(err) => {
            #[cfg(target_arch = "wasm32")]
            web_sys::console::log_1(&format!("outcome {:?}", err).into());
            Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?)
        },
    }
}

// wasm_bindgen wrapper for mock execute
#[wasm_bindgen]
pub async fn execute_mock(
    program_ast_json: &str,
    path: Option<String>,
    settings: &str,
    use_prev_memory: bool,
    variables: &str,
    fs_manager: kcl_lib::wasm_engine::FileSystemManager,
) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let program: Program = serde_json::from_str(program_ast_json).map_err(|e| e.to_string())?;
    let variables = serde_json::from_str(variables).map_err(|e| e.to_string())?;
    let config: kcl_lib::Configuration = serde_json::from_str(settings).map_err(|e| e.to_string())?;
    let mut settings: kcl_lib::ExecutorSettings = config.into();
    if let Some(path) = path {
        settings.with_current_file(std::path::PathBuf::from(path));
    }

    let ctx = kcl_lib::ExecutorContext::new_mock(fs_manager, settings.into()).await?;
    match ctx.run_mock(program, use_prev_memory, variables).await {
        // The serde-wasm-bindgen does not work here because of weird HashMap issues.
        // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
        Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
        Err(err) => Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?),
    }
}

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

// wasm_bindgen wrapper for creating default planes
#[wasm_bindgen]
pub async fn make_default_planes(
    engine_manager: kcl_lib::wasm_engine::EngineCommandManager,
) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let engine = kcl_lib::wasm_engine::EngineConnection::new(engine_manager)
        .await
        .map_err(|e| format!("{:?}", e))?;
    let default_planes = engine
        .new_default_planes(&mut kcl_lib::exec::IdGenerator::default(), Default::default())
        .await
        .map_err(String::from)?;

    JsValue::from_serde(&default_planes).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub async fn modify_ast_for_sketch_wasm(
    manager: kcl_lib::wasm_engine::EngineCommandManager,
    program_ast_json: &str,
    sketch_name: &str,
    plane_type: &str,
    sketch_id: &str,
) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let mut program: Program = serde_json::from_str(program_ast_json).map_err(|e| e.to_string())?;

    let plane: kcl_lib::exec::PlaneType = serde_json::from_str(plane_type).map_err(|e| e.to_string())?;

    let engine: Arc<Box<dyn EngineManager>> = Arc::new(Box::new(
        kcl_lib::wasm_engine::EngineConnection::new(manager)
            .await
            .map_err(|e| format!("{:?}", e))?,
    ));

    let module_id = ModuleId::default();
    let _ = kcl_lib::modify_ast_for_sketch(
        &engine,
        &mut program,
        module_id,
        sketch_name,
        plane,
        uuid::Uuid::parse_str(sketch_id).map_err(|e| e.to_string())?,
    )
    .await
    .map_err(String::from)?;

    JsValue::from_serde(&program).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn deserialize_files(data: &[u8]) -> Result<JsValue, JsError> {
    console_error_panic_hook::set_once();

    let ws_resp: kittycad::types::WebSocketResponse = bson::from_slice(data)?;

    if let Some(success) = ws_resp.success {
        if !success {
            return Err(JsError::new(&format!("Server returned error: {:?}", ws_resp.errors)));
        }
    }

    if let Some(kittycad::types::OkWebSocketResponseData::Export { files }) = ws_resp.resp {
        return Ok(JsValue::from_serde(&files)?);
    }

    Err(JsError::new(&format!("Invalid response type, got: {:?}", ws_resp)))
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
pub struct ServerConfig {
    into_server: js_sys::AsyncIterator,
    from_server: web_sys::WritableStream,
    fs: kcl_lib::wasm_engine::FileSystemManager,
}

#[wasm_bindgen]
impl ServerConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(
        into_server: js_sys::AsyncIterator,
        from_server: web_sys::WritableStream,
        fs: kcl_lib::wasm_engine::FileSystemManager,
    ) -> Self {
        Self {
            into_server,
            from_server,
            fs,
        }
    }
}

/// Run the `kcl` lsp server.
//
// NOTE: we don't use web_sys::ReadableStream for input here because on the
// browser side we need to use a ReadableByteStreamController to construct it
// and so far only Chromium-based browsers support that functionality.

// NOTE: input needs to be an AsyncIterator<Uint8Array, never, void> specifically
#[wasm_bindgen]
pub async fn kcl_lsp_run(
    config: ServerConfig,
    engine_manager: Option<kcl_lib::wasm_engine::EngineCommandManager>,
    settings: Option<String>,
    token: String,
    baseurl: String,
) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    let ServerConfig {
        into_server,
        from_server,
        fs,
    } = config;

    let executor_ctx = if let Some(engine_manager) = engine_manager {
        let settings: kcl_lib::Configuration = if let Some(settings) = settings {
            serde_json::from_str(&settings).map_err(|e| e.to_string())?
        } else {
            Default::default()
        };
        Some(kcl_lib::ExecutorContext::new(engine_manager, fs.clone(), settings.into()).await?)
    } else {
        None
    };

    let mut zoo_client = kittycad::Client::new(token);
    zoo_client.set_base_url(baseurl.as_str());

    // Check if we can send telemetry for this user.
    let can_send_telemetry = match zoo_client.users().get_privacy_settings().await {
        Ok(privacy_settings) => privacy_settings.can_train_on_data,
        Err(err) => {
            // In the case of dev we don't always have a sub set, but prod we should.
            if err
                .to_string()
                .contains("The modeling app subscription type is missing.")
            {
                true
            } else {
                web_sys::console::warn_1(&format!("Failed to get privacy settings: {err:?}").into());
                false
            }
        }
    };

    let (service, socket) = LspService::build(|client| {
        kcl_lib::KclLspBackend::new_wasm(client, executor_ctx, fs, zoo_client, can_send_telemetry).unwrap()
    })
    .custom_method("kcl/updateUnits", kcl_lib::KclLspBackend::update_units)
    .custom_method("kcl/updateCanExecute", kcl_lib::KclLspBackend::update_can_execute)
    .finish();

    let input = wasm_bindgen_futures::stream::JsStream::from(into_server);
    let input = input
        .map_ok(|value| {
            value
                .dyn_into::<js_sys::Uint8Array>()
                .expect("could not cast stream item to Uint8Array")
                .to_vec()
        })
        .map_err(|_err| std::io::Error::from(std::io::ErrorKind::Other))
        .into_async_read();

    let output = wasm_bindgen::JsCast::unchecked_into::<wasm_streams::writable::sys::WritableStream>(from_server);
    let output = wasm_streams::WritableStream::from_raw(output);
    let output = output.try_into_async_write().map_err(|err| err.0)?;

    Server::new(input, output, socket).serve(service).await;

    Ok(())
}

/// Run the `copilot` lsp server.
//
// NOTE: we don't use web_sys::ReadableStream for input here because on the
// browser side we need to use a ReadableByteStreamController to construct it
// and so far only Chromium-based browsers support that functionality.

// NOTE: input needs to be an AsyncIterator<Uint8Array, never, void> specifically
#[wasm_bindgen]
pub async fn copilot_lsp_run(config: ServerConfig, token: String, baseurl: String) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    let ServerConfig {
        into_server,
        from_server,
        fs,
    } = config;

    let mut zoo_client = kittycad::Client::new(token);
    zoo_client.set_base_url(baseurl.as_str());

    let dev_mode = baseurl == "https://api.dev.zoo.dev";

    let (service, socket) =
        LspService::build(|client| kcl_lib::CopilotLspBackend::new_wasm(client, fs, zoo_client, dev_mode))
            .custom_method("copilot/setEditorInfo", kcl_lib::CopilotLspBackend::set_editor_info)
            .custom_method(
                "copilot/getCompletions",
                kcl_lib::CopilotLspBackend::get_completions_cycling,
            )
            .custom_method("copilot/notifyAccepted", kcl_lib::CopilotLspBackend::accept_completion)
            .custom_method("copilot/notifyRejected", kcl_lib::CopilotLspBackend::reject_completions)
            .finish();

    let input = wasm_bindgen_futures::stream::JsStream::from(into_server);
    let input = input
        .map_ok(|value| {
            value
                .dyn_into::<js_sys::Uint8Array>()
                .expect("could not cast stream item to Uint8Array")
                .to_vec()
        })
        .map_err(|_err| std::io::Error::from(std::io::ErrorKind::Other))
        .into_async_read();

    let output = wasm_bindgen::JsCast::unchecked_into::<wasm_streams::writable::sys::WritableStream>(from_server);
    let output = wasm_streams::WritableStream::from_raw(output);
    let output = output.try_into_async_write().map_err(|err| err.0)?;

    Server::new(input, output, socket).serve(service).await;

    Ok(())
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

/// Serialize the project settings.
#[wasm_bindgen]
pub fn serialize_project_settings(val: JsValue) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let config: kcl_lib::Configuration = val.into_serde().map_err(|e| e.to_string())?;

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
    let mut program = Program::parse_no_errs(code).map_err(|e| e.to_string())?;

    let new_program = program.change_meta_settings(settings).map_err(|e| e.to_string())?;

    let formatted = new_program.recast();

    Ok(formatted)
}

/// Get the version of the kcl library.
#[wasm_bindgen]
pub fn get_kcl_version() -> String {
    console_error_panic_hook::set_once();

    kcl_lib::version().to_string()
}
