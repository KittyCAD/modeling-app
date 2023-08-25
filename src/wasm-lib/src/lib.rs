//! Wasm bindings for `kcl`.

use gloo_utils::format::JsValueSerdeExt;
use wasm_bindgen::prelude::*;

// wasm_bindgen wrapper for execute
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub async fn execute_wasm(
    program_str: &str,
    memory_str: &str,
    manager: kcl::engine::conn_wasm::EngineCommandManager,
) -> Result<JsValue, String> {
    // deserialize the ast from a stringified json
    let program: kcl::abstract_syntax_tree_types::Program =
        serde_json::from_str(program_str).map_err(|e| e.to_string())?;
    let mut mem: kcl::executor::ProgramMemory =
        serde_json::from_str(memory_str).map_err(|e| e.to_string())?;

    let mut engine = kcl::engine::EngineConnection::new(manager)
        .await
        .map_err(|e| format!("{:?}", e))?;

    let memory = kcl::executor::execute(
        program,
        &mut mem,
        kcl::executor::BodyType::Root,
        &mut engine,
    )
    .map_err(String::from)?;
    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&memory).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn deserialize_files(data: &[u8]) -> Result<JsValue, JsError> {
    let ws_resp: kittycad::types::WebSocketResponse = bincode::deserialize(data)?;

    if !ws_resp.success {
        return Err(JsError::new(&format!(
            "Server returned error: {:?}",
            ws_resp.errors
        )));
    }

    if let Some(kittycad::types::OkWebSocketResponseData::Export { files }) = ws_resp.resp {
        return Ok(JsValue::from_serde(&files)?);
    }

    Err(JsError::new(&format!(
        "Invalid response type, got: {:?}",
        ws_resp
    )))
}
