//! Rust support for KCL (aka the KittyCAD Language).
//!
//! KCL is written in Rust. This crate contains the compiler tooling (e.g. parser, lexer, code generation),
//! the standard library implementation, a LSP implementation, generator for the docs, and more.
#![recursion_limit = "1024"]
#![allow(clippy::boxed_local)]

#[allow(unused_macros)]
macro_rules! println {
    ($($rest:tt)*) => {
        #[cfg(not(feature = "disable-println"))]
        std::println!($($rest)*)
    }
}

pub mod ast;
pub mod coredump;
pub mod docs;
pub mod engine;
pub mod errors;
pub mod executor;
pub mod fs;
mod function_param;
pub mod lint;
pub mod lsp;
pub mod parser;
pub mod settings;
#[cfg(test)]
mod simulation_tests;
pub mod std;
#[cfg(not(target_arch = "wasm32"))]
pub mod test_server;
pub mod thread;
pub mod token;
mod unparser;
pub mod walk;
#[cfg(target_arch = "wasm32")]
pub mod wasm;
