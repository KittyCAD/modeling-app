//! Wasm bindings for `kcl`.

#[cfg(target_arch = "wasm32")]
use futures::stream::TryStreamExt;
use gloo_utils::format::JsValueSerdeExt;
#[cfg(target_arch = "wasm32")]
use kcl_lib::server::{get_completions_from_stdlib, get_signatures_from_stdlib, Backend};
#[cfg(target_arch = "wasm32")]
use tower_lsp::{LspService, Server};
use wasm_bindgen::prelude::*;

// wasm_bindgen wrapper for execute
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub async fn execute_wasm(
    program_str: &str,
    memory_str: &str,
    manager: kcl_lib::engine::conn_wasm::EngineCommandManager,
) -> Result<JsValue, String> {
    // deserialize the ast from a stringified json
    let program: kcl_lib::ast::types::Program = serde_json::from_str(program_str).map_err(|e| e.to_string())?;
    let mut mem: kcl_lib::executor::ProgramMemory = serde_json::from_str(memory_str).map_err(|e| e.to_string())?;

    let engine = kcl_lib::engine::EngineConnection::new(manager)
        .await
        .map_err(|e| format!("{:?}", e))?;

    let memory = kcl_lib::executor::execute(program, &mut mem, kcl_lib::executor::BodyType::Root, &engine)
        .await
        .map_err(String::from)?;
    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&memory).map_err(|e| e.to_string())
}

// wasm_bindgen wrapper for execute
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub async fn modify_ast_for_sketch(
    manager: kcl_lib::engine::conn_wasm::EngineCommandManager,
    program_str: &str,
    sketch_name: &str,
    sketch_id: &str,
) -> Result<JsValue, String> {
    // deserialize the ast from a stringified json
    let mut program: kcl_lib::ast::types::Program = serde_json::from_str(program_str).map_err(|e| e.to_string())?;

    let mut engine = kcl_lib::engine::EngineConnection::new(manager)
        .await
        .map_err(|e| format!("{:?}", e))?;

    let _ = kcl_lib::ast::modify::modify_ast_for_sketch(
        &mut engine,
        &mut program,
        sketch_name,
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
    let tokens = kcl_lib::token::lexer(js);
    Ok(JsValue::from_serde(&tokens)?)
}

#[wasm_bindgen]
pub fn parse_wasm(js: &str) -> Result<JsValue, String> {
    let tokens = kcl_lib::token::lexer(js);
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
    // deserialize the ast from a stringified json
    let program: kcl_lib::ast::types::Program = serde_json::from_str(json_str).map_err(JsError::from)?;

    // Use the default options until we integrate into the UI the ability to change them.
    let result = program.recast(&Default::default(), 0);
    Ok(JsValue::from_serde(&result)?)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct ServerConfig {
    into_server: js_sys::AsyncIterator,
    from_server: web_sys::WritableStream,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl ServerConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(into_server: js_sys::AsyncIterator, from_server: web_sys::WritableStream) -> Self {
        Self {
            into_server,
            from_server,
        }
    }
}

/// Run the `kcl` lsp server.
//
// NOTE: we don't use web_sys::ReadableStream for input here because on the
// browser side we need to use a ReadableByteStreamController to construct it
// and so far only Chromium-based browsers support that functionality.

// NOTE: input needs to be an AsyncIterator<Uint8Array, never, void> specifically
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub async fn lsp_run(config: ServerConfig) -> Result<(), JsValue> {
    let ServerConfig {
        into_server,
        from_server,
    } = config;

    let stdlib = kcl_lib::std::StdLib::new();
    let stdlib_completions = get_completions_from_stdlib(&stdlib).map_err(|e| e.to_string())?;
    let stdlib_signatures = get_signatures_from_stdlib(&stdlib).map_err(|e| e.to_string())?;
    // We can unwrap here because we know the tokeniser is valid, since
    // we have a test for it.
    let token_types = kcl_lib::token::TokenType::all_semantic_token_types().unwrap();

    let (service, socket) = LspService::new(|client| Backend {
        client,
        stdlib_completions,
        stdlib_signatures,
        token_types,
        token_map: Default::default(),
        ast_map: Default::default(),
        current_code_map: Default::default(),
        diagnostics_map: Default::default(),
        symbols_map: Default::default(),
        semantic_tokens_map: Default::default(),
    });

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
