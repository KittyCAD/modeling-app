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

mod ast;
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

pub use ast::modify::modify_ast_for_sketch;
pub use ast::types::ModuleId;
pub use errors::KclError;

#[derive(Clone, Debug, PartialEq)]
pub struct Program {
    ast: ast::types::Node<ast::types::Program>,
}

impl Program {
    pub fn parse(input: &str) -> Result<Program, KclError> {
        let module_id = ModuleId::default();
        let tokens = token::lexer(input, module_id)?;
        let parser = parser::Parser::new(tokens);
        let ast = parser.ast()?;

        Ok(Program { ast })
    }
}

impl From<ast::types::Node<ast::types::Program>> for Program {
    fn from(ast: ast::types::Node<ast::types::Program>) -> Program {
        Self { ast }
    }
}
