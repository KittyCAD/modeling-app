//! Functions for interacting with TOML files.
//! We do this in rust because the Javascript TOML libraries are actual trash.

use kcl_lib::settings::types::Configuration;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub fn toml_stringify(json: &str) -> Result<String, String> {
    console_error_panic_hook::set_once();

    #[cfg(target_arch = "wasm32")]
    web_sys::console::log_1(&format!("json {:?}", json).into());

    let value: Configuration = serde_json::from_str(json).map_err(|e| e.to_string())?;

    #[cfg(target_arch = "wasm32")]
    web_sys::console::log_1(&format!("SERDE {:?}", value).into());

    toml::to_string_pretty(&value).map_err(|e| e.to_string())
}
