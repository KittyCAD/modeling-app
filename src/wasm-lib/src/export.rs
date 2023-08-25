//! Functions for exported files from the server.

use gloo_utils::format::JsValueSerdeExt;
use wasm_bindgen::prelude::*;

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
