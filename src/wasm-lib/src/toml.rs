//! Functions for interacting with TOML files.
//! We do this in rust because the Javascript TOML libraries are actual trash.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub fn toml_stringify(json: &str) -> Result<String, String> {
    console_error_panic_hook::set_once();

    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;

    toml::to_string_pretty(&value).map_err(|e| e.to_string())
}
