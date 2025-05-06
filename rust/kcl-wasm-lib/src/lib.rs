//! Wasm bindings for `kcl`.

#[cfg(target_arch = "wasm32")]
mod context;
#[cfg(target_arch = "wasm32")]
mod lsp;
#[cfg(all(target_arch = "wasm32", test))]
mod tests;
#[cfg(target_arch = "wasm32")]
mod wasm;

#[cfg(target_arch = "wasm32")]
pub use context::*;
#[cfg(target_arch = "wasm32")]
pub use lsp::*;
#[cfg(target_arch = "wasm32")]
pub use wasm::*;
