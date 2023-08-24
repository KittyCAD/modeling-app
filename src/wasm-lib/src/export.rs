//! Functions for exported files from the server.

use gloo_utils::format::JsValueSerdeExt;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn deserialize_files(data: &[u8]) -> Result<JsValue, JsError> {
    let ws_resp: kittycad::types::WebSocketResponses = bincode::deserialize(data)?;

    if let kittycad::types::WebSocketResponses::Export { files } = ws_resp {
        return Ok(JsValue::from_serde(&files)?);
    }

    Err(JsError::new(&format!(
        "Invalid response type, got: {:?}",
        ws_resp
    )))
}
