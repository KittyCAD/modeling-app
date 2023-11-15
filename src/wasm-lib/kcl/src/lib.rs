//! Rust support for KCL (aka the KittyCAD Language).
//!
//! KCL is written in Rust. This crate contains the compiler tooling (e.g. parser, lexer, code generation),
//! the standard library implementation, a LSP implementation, generator for the docs, and more.
#![recursion_limit = "1024"]

pub mod ast;
pub mod docs;
pub mod engine;
pub mod errors;
pub mod executor;
pub mod parser;
pub mod server;
pub mod std;
pub mod token;
