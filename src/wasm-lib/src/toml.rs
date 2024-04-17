//! Functions for interacting with TOML files.
//! We do this in rust because the Javascript TOML libraries are actual trash.

use gloo_utils::format::JsValueSerdeExt;
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};

#[wasm_bindgen]
pub fn toml_parse(s: &str) -> Result<JsValue, String> {
    console_error_panic_hook::set_once();

    let value: toml::Value = toml::from_str(s).map_err(|e| e.to_string())?;

    // The serde-wasm-bindgen does not work here because of weird HashMap issues so we use the
    // gloo-serialize crate instead.
    JsValue::from_serde(&value).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn toml_stringify(json: &str) -> Result<String, String> {
    console_error_panic_hook::set_once();

    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;

    toml::to_string_pretty(&value).map_err(|e| e.to_string())
}
