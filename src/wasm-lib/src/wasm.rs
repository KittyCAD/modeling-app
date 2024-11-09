//! Wasm bindings for `kcl`.

use std::{
    str::FromStr,
    sync::{Arc, RwLock},
};

use futures::stream::TryStreamExt;
use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::{
    ast::types::{ModuleId, Node, Program},
    coredump::CoreDump,
    engine::EngineManager,
    executor::ExecutorSettings,
};
use tower_lsp::{LspService, Server};
use wasm_bindgen::prelude::*;

// wasm_bindgen wrapper for execute
#[wasm_bindgen]
pub async fn execute_wasm(
    program_str: &str,
    memory_str: &str,
    id_generator_str: &str,
    units: &str,
    engine_manager: kcl_lib::engine::conn_wasm::EngineCommandManager,
    fs_manager: kcl_lib::fs::wasm::FileSystemManager,
    project_directory: Option<String>,
    is_mock: bool,
) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();
    // deserialize the ast from a stringified json

    let program: Node<Program> = serde_json::from_str(program_str).map_err(|e| e.to_string())?;
    let memory: kcl_lib::executor::ProgramMemory = serde_json::from_str(memory_str).map_err(|e| e.to_string())?;
    let id_generator: kcl_lib::executor::IdGenerator =
        serde_json::from_str(id_generator_str).map_err(|e| e.to_string())?;
    let units = kcl_lib::settings::types::UnitLength::from_str(units).map_err(|e| e.to_string())?;

    let engine: std::sync::Arc<Box<dyn kcl_lib::engine::EngineManager>> = if is_mock {
        Arc::new(Box::new(
            kcl_lib::engine::conn_mock::EngineConnection::new()
                .await
                .map_err(|e| format!("{:?}", e))?,
        ))
    } else {
        Arc::new(Box::new(
            kcl_lib::engine::conn_wasm::EngineConnection::new(engine_manager)
                .await
                .map_err(|e| format!("{:?}", e))?,
        ))
    };
    let fs = Arc::new(kcl_lib::fs::FileManager::new(fs_manager));
    let context_type = if is_mock {
        kcl_lib::executor::ContextType::Mock
    } else {
        kcl_lib::executor::ContextType::Live
    };
    let ctx = kcl_lib::executor::ExecutorContext {
        engine,
        fs,
        stdlib: std::sync::Arc::new(kcl_lib::std::StdLib::new()),
        settings: ExecutorSettings {
            units,
            ..Default::default()
        },
        context_type,
    };

    let exec_state = ctx
        .run(&program, Some(memory), id_generator, project_directory)
        .await
        .map_err(String::from)?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    // DO NOT USE serde_wasm_bindgen::to_value(&exec_state).map_err(|e| e.to_string())
    // it will break the frontend.
    JsValue::from_serde(&exec_state).map_err(|e| e.to_string())
}

// wasm_bindgen wrapper for execute
#[wasm_bindgen]
pub async fn kcl_lint(program_str: &str) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let program: Node<Program> = serde_json::from_str(program_str).map_err(|e| e.to_string())?;
    let mut findings = vec![];
    for discovered_finding in program.lint_all().into_iter().flatten() {
        findings.push(discovered_finding);
    }

    Ok(JsValue::from_serde(&findings).map_err(|e| e.to_string())?)
}

// wasm_bindgen wrapper for creating default planes
#[wasm_bindgen]
pub async fn make_default_planes(
    engine_manager: kcl_lib::engine::conn_wasm::EngineCommandManager,
) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();
    // deserialize the ast from a stringified json

    let engine = kcl_lib::engine::conn_wasm::EngineConnection::new(engine_manager)
        .await
        .map_err(|e| format!("{:?}", e))?;
    let default_planes = engine
        .new_default_planes(&mut kcl_lib::executor::IdGenerator::default(), Default::default())
        .await
        .map_err(String::from)?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&default_planes).map_err(|e| e.to_string())
}

// wasm_bindgen wrapper for modifying the grid
#[wasm_bindgen]
pub async fn modify_grid(
    engine_manager: kcl_lib::engine::conn_wasm::EngineCommandManager,
    hidden: bool,
) -> Result<(), String> {
    console_error_panic_hook::set_once();
    // deserialize the ast from a stringified json

    let engine = kcl_lib::engine::conn_wasm::EngineConnection::new(engine_manager)
        .await
        .map_err(|e| format!("{:?}", e))?;
    engine.modify_grid(hidden).await.map_err(String::from)?;

    Ok(())
}

// wasm_bindgen wrapper for execute
#[wasm_bindgen]
pub async fn modify_ast_for_sketch_wasm(
    manager: kcl_lib::engine::conn_wasm::EngineCommandManager,
    program_str: &str,
    sketch_name: &str,
    plane_type: &str,
    sketch_id: &str,
) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    // deserialize the ast from a stringified json
    let mut program: Node<Program> = serde_json::from_str(program_str).map_err(|e| e.to_string())?;

    let plane: kcl_lib::executor::PlaneType = serde_json::from_str(plane_type).map_err(|e| e.to_string())?;

    let engine: Arc<Box<dyn EngineManager>> = Arc::new(Box::new(
        kcl_lib::engine::conn_wasm::EngineConnection::new(manager)
            .await
            .map_err(|e| format!("{:?}", e))?,
    ));

    let module_id = ModuleId::default();
    let _ = kcl_lib::ast::modify::modify_ast_for_sketch(
        &engine,
        &mut program,
        module_id,
        sketch_name,
        plane,
        uuid::Uuid::parse_str(sketch_id).map_err(|e| e.to_string())?,
    )
    .await
    .map_err(String::from)?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
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

// wasm_bindgen wrapper for lexer
// test for this function and by extension lexer are done in javascript land src/lang/tokeniser.test.ts
#[wasm_bindgen]
pub fn lexer_wasm(js: &str) -> Result<JsValue, JsError> {
    console_error_panic_hook::set_once();

    let module_id = ModuleId::default();
    let tokens = kcl_lib::token::lexer(js, module_id).map_err(JsError::from)?;
    Ok(JsValue::from_serde(&tokens)?)
}

#[wasm_bindgen]
pub fn parse_wasm(js: &str) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let module_id = ModuleId::default();
    let tokens = kcl_lib::token::lexer(js, module_id).map_err(String::from)?;
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast().map_err(String::from)?;
    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&program).map_err(|e| e.to_string())
}

// wasm_bindgen wrapper for recast
// test for this function and by extension the recaster are done in javascript land src/lang/recast.test.ts
#[wasm_bindgen]
pub fn recast_wasm(json_str: &str) -> Result<JsValue, JsError> {
    console_error_panic_hook::set_once();

    // deserialize the ast from a stringified json
    let program: kcl_lib::ast::types::Program = serde_json::from_str(json_str).map_err(JsError::from)?;

    // Use the default options until we integrate into the UI the ability to change them.
    let result = program.recast(&Default::default(), 0);
    Ok(JsValue::from_serde(&result)?)
}

#[wasm_bindgen]
pub struct ServerConfig {
    into_server: js_sys::AsyncIterator,
    from_server: web_sys::WritableStream,
    fs: kcl_lib::fs::wasm::FileSystemManager,
}

#[wasm_bindgen]
impl ServerConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(
        into_server: js_sys::AsyncIterator,
        from_server: web_sys::WritableStream,
        fs: kcl_lib::fs::wasm::FileSystemManager,
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
    engine_manager: Option<kcl_lib::engine::conn_wasm::EngineCommandManager>,
    units: &str,
    token: String,
    baseurl: String,
) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    let ServerConfig {
        into_server,
        from_server,
        fs,
    } = config;

    let stdlib = kcl_lib::std::StdLib::new();
    let stdlib_completions = kcl_lib::lsp::kcl::get_completions_from_stdlib(&stdlib).map_err(|e| e.to_string())?;
    let stdlib_signatures = kcl_lib::lsp::kcl::get_signatures_from_stdlib(&stdlib).map_err(|e| e.to_string())?;

    let mut zoo_client = kittycad::Client::new(token);
    zoo_client.set_base_url(baseurl.as_str());

    let file_manager = Arc::new(kcl_lib::fs::FileManager::new(fs));

    let executor_ctx = if let Some(engine_manager) = engine_manager {
        let units = kcl_lib::settings::types::UnitLength::from_str(units).map_err(|e| e.to_string())?;
        let engine = kcl_lib::engine::conn_wasm::EngineConnection::new(engine_manager)
            .await
            .map_err(|e| format!("{:?}", e))?;
        Some(kcl_lib::executor::ExecutorContext {
            engine: Arc::new(Box::new(engine)),
            fs: file_manager.clone(),
            stdlib: std::sync::Arc::new(stdlib),
            settings: ExecutorSettings {
                units,
                ..Default::default()
            },
            context_type: kcl_lib::executor::ContextType::Live,
        })
    } else {
        None
    };

    // Check if we can send telememtry for this user.
    let privacy_settings = match zoo_client.users().get_privacy_settings().await {
        Ok(privacy_settings) => privacy_settings,
        Err(err) => {
            // In the case of dev we don't always have a sub set, but prod we should.
            if err
                .to_string()
                .contains("The modeling app subscription type is missing.")
            {
                kittycad::types::PrivacySettings {
                    can_train_on_data: true,
                }
            } else {
                return Err(err.to_string().into());
            }
        }
    };

    let (service, socket) = LspService::build(|client| kcl_lib::lsp::kcl::Backend {
        client,
        fs: file_manager,
        workspace_folders: Default::default(),
        stdlib_completions,
        stdlib_signatures,
        token_map: Default::default(),
        ast_map: Default::default(),
        memory_map: Default::default(),
        code_map: Default::default(),
        diagnostics_map: Default::default(),
        symbols_map: Default::default(),
        semantic_tokens_map: Default::default(),
        zoo_client,
        can_send_telemetry: privacy_settings.can_train_on_data,
        can_execute: Arc::new(tokio::sync::RwLock::new(executor_ctx.is_some())),
        executor_ctx: Arc::new(tokio::sync::RwLock::new(executor_ctx)),

        is_initialized: Default::default(),
    })
    .custom_method("kcl/updateUnits", kcl_lib::lsp::kcl::Backend::update_units)
    .custom_method("kcl/updateCanExecute", kcl_lib::lsp::kcl::Backend::update_can_execute)
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

    let file_manager = Arc::new(kcl_lib::fs::FileManager::new(fs));

    let (service, socket) = LspService::build(|client| kcl_lib::lsp::copilot::Backend {
        client,
        fs: file_manager,
        workspace_folders: Default::default(),
        code_map: Default::default(),
        editor_info: Arc::new(RwLock::new(kcl_lib::lsp::copilot::types::CopilotEditorInfo::default())),
        cache: Arc::new(kcl_lib::lsp::copilot::cache::CopilotCache::new()),
        telemetry: Default::default(),
        zoo_client,

        is_initialized: Default::default(),
        diagnostics_map: Default::default(),
        dev_mode: if baseurl == "https://api.dev.zoo.dev" {
            true
        } else {
            false
        },
    })
    .custom_method("copilot/setEditorInfo", kcl_lib::lsp::copilot::Backend::set_editor_info)
    .custom_method(
        "copilot/getCompletions",
        kcl_lib::lsp::copilot::Backend::get_completions_cycling,
    )
    .custom_method(
        "copilot/notifyAccepted",
        kcl_lib::lsp::copilot::Backend::accept_completion,
    )
    .custom_method(
        "copilot/notifyRejected",
        kcl_lib::lsp::copilot::Backend::reject_completions,
    )
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

    kcl_lib::std::utils::is_points_ccw_wasm(points)
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

    let result = kcl_lib::std::utils::get_tangential_arc_to_info(kcl_lib::std::utils::TangentialArcInfoInput {
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

/// Create the default program memory.
#[wasm_bindgen]
pub fn program_memory_init() -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let memory = kcl_lib::executor::ProgramMemory::default();

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&memory).map_err(|e| e.to_string())
}

/// Get a coredump.
#[wasm_bindgen]
pub async fn coredump(core_dump_manager: kcl_lib::coredump::wasm::CoreDumpManager) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let core_dumper = kcl_lib::coredump::wasm::CoreDumper::new(core_dump_manager);
    let dump = core_dumper.dump().await.map_err(|e| e.to_string())?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&dump).map_err(|e| e.to_string())
}

/// Get the default app settings.
#[wasm_bindgen]
pub fn default_app_settings() -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let settings = kcl_lib::settings::types::Configuration::default();

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&settings).map_err(|e| e.to_string())
}

/// Parse the app settings.
#[wasm_bindgen]
pub fn parse_app_settings(toml_str: &str) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let settings = kcl_lib::settings::types::Configuration::backwards_compatible_toml_parse(&toml_str)
        .map_err(|e| e.to_string())?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&settings).map_err(|e| e.to_string())
}

/// Get the default project settings.
#[wasm_bindgen]
pub fn default_project_settings() -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let settings = kcl_lib::settings::types::project::ProjectConfiguration::default();

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&settings).map_err(|e| e.to_string())
}

/// Parse (deserialize) the project settings.
#[wasm_bindgen]
pub fn parse_project_settings(toml_str: &str) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let settings = kcl_lib::settings::types::project::ProjectConfiguration::backwards_compatible_toml_parse(&toml_str)
        .map_err(|e| e.to_string())?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&settings).map_err(|e| e.to_string())
}

/// Serialize the project settings.
#[wasm_bindgen]
pub fn serialize_project_settings(val: JsValue) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let config: kcl_lib::settings::types::Configuration = val.into_serde().map_err(|e| e.to_string())?;

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
