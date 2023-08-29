//! Wasm bindings for `kcl`.

use gloo_utils::format::JsValueSerdeExt;
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
    let program: kcl_lib::abstract_syntax_tree_types::Program =
        serde_json::from_str(program_str).map_err(|e| e.to_string())?;
    let mut mem: kcl_lib::executor::ProgramMemory = serde_json::from_str(memory_str).map_err(|e| e.to_string())?;

    let mut engine = kcl_lib::engine::EngineConnection::new(manager)
        .await
        .map_err(|e| format!("{:?}", e))?;

    let memory = kcl_lib::executor::execute(program, &mut mem, kcl_lib::executor::BodyType::Root, &mut engine)
        .map_err(String::from)?;
    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&memory).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn deserialize_files(data: &[u8]) -> Result<JsValue, JsError> {
    let ws_resp: kittycad::types::WebSocketResponse = bson::from_slice(data)?;

    if !ws_resp.success {
        return Err(JsError::new(&format!("Server returned error: {:?}", ws_resp.errors)));
    }

    if let Some(kittycad::types::OkWebSocketResponseData::Export { files }) = ws_resp.resp {
        return Ok(JsValue::from_serde(&files)?);
    }

    Err(JsError::new(&format!("Invalid response type, got: {:?}", ws_resp)))
}

// wasm_bindgen wrapper for lexer
// test for this function and by extension lexer are done in javascript land src/lang/tokeniser.test.ts
#[wasm_bindgen]
pub fn lexer_js(js: &str) -> Result<JsValue, JsError> {
    let tokens = kcl_lib::tokeniser::lexer(js);
    Ok(JsValue::from_serde(&tokens)?)
}

#[wasm_bindgen]
pub fn parse_js(js: &str) -> Result<JsValue, String> {
    let tokens = kcl_lib::tokeniser::lexer(js);
    let program = kcl_lib::parser::abstract_syntax_tree(&tokens).map_err(String::from)?;
    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&program).map_err(|e| e.to_string())
}

// wasm_bindgen wrapper for recast
// test for this function and by extension the recaster are done in javascript land src/lang/recast.test.ts
#[wasm_bindgen]
pub fn recast_wasm(json_str: &str) -> Result<JsValue, JsError> {
    // deserialize the ast from a stringified json
    let program: kcl_lib::abstract_syntax_tree_types::Program =
        serde_json::from_str(json_str).map_err(JsError::from)?;

    let result = kcl_lib::recast::recast(&program, "", false);
    Ok(JsValue::from_serde(&result)?)
}
