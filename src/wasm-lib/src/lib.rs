//! Wasm bindings for `kcl`.

#[cfg(target_arch = "wasm32")]
mod toml;
#[cfg(target_arch = "wasm32")]
mod wasm;

#[cfg(target_arch = "wasm32")]
pub use toml::*;
#[cfg(target_arch = "wasm32")]
pub use wasm::*;
