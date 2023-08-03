//! Functions for exported files from the server.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// A file that has been exported from the server.
#[derive(Debug, Deserialize, Serialize)]
pub struct File {
    pub name: String,
    pub contents: Vec<u8>,
}

#[wasm_bindgen]
pub fn deserialize_files(data: Vec<u8>) -> Result<JsValue, JsError> {
    let files: Vec<File> = bincode::deserialize(&data)?;

    Ok(serde_wasm_bindgen::to_value(&files)?)
}
