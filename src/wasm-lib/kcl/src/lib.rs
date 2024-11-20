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
mod coredump;
mod docs;
mod engine;
mod errors;
mod executor;
mod fs;
mod function_param;
pub mod lint;
mod lsp;
mod parser;
mod settings;
#[cfg(test)]
mod simulation_tests;
mod std;
#[cfg(not(target_arch = "wasm32"))]
pub mod test_server;
mod thread;
mod token;
mod unparser;
mod walk;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use ast::modify::modify_ast_for_sketch;
pub use ast::types::{FormatOptions, ModuleId};
pub use coredump::CoreDump;
pub use engine::{EngineManager, ExecutionKind};
pub use errors::KclError;
pub use executor::{ExecState, ExecutorContext, ExecutorSettings, SourceRange};
pub use lsp::copilot::Backend as CopilotLspBackend;
pub use lsp::kcl::Backend as KclLspBackend;
pub use lsp::kcl::Server as KclLspServerSubCommand;
pub use settings::types::{project::ProjectConfiguration, Configuration, UnitLength};
pub use token::lexer;

// Rather than make executor public and make lots of it pub(crate), just re-export into a new module.
// Ideally we wouldn't export these things at all, they should only be used for testing.
pub mod exec {
    pub use crate::executor::{DefaultPlanes, IdGenerator, KclValue, PlaneType, ProgramMemory, Sketch};
}

#[cfg(target_arch = "wasm32")]
pub mod wasm_engine {
    pub use crate::coredump::wasm::{CoreDumpManager, CoreDumper};
    pub use crate::engine::conn_wasm::{EngineCommandManager, EngineConnection};
    pub use crate::fs::wasm::FileSystemManager;
}

#[cfg(not(target_arch = "wasm32"))]
pub mod native_engine {
    pub use crate::engine::conn::EngineConnection;
}

pub mod std_utils {
    pub use crate::std::utils::{get_tangential_arc_to_info, is_points_ccw_wasm, TangentialArcInfoInput};
}

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Program {
    #[serde(flatten)]
    ast: ast::types::Node<ast::types::Program>,
}

#[cfg(any(test, feature = "lsp-test-util"))]
pub use lsp::test_util::copilot_lsp_server;
#[cfg(any(test, feature = "lsp-test-util"))]
pub use lsp::test_util::kcl_lsp_server;

impl Program {
    pub fn parse(input: &str) -> Result<Program, KclError> {
        let module_id = ModuleId::default();
        let tokens = token::lexer(input, module_id)?;
        let ast = parser::parse_tokens(tokens)?;

        Ok(Program { ast })
    }

    pub fn compute_digest(&mut self) -> ast::types::digest::Digest {
        self.ast.compute_digest()
    }

    pub fn lint_all(&self) -> Result<Vec<lint::Discovered>, anyhow::Error> {
        self.ast.lint_all()
    }

    pub fn lint<'a>(&'a self, rule: impl lint::Rule<'a>) -> Result<Vec<lint::Discovered>, anyhow::Error> {
        self.ast.lint(rule)
    }

    pub fn recast(&self) -> String {
        // Use the default options until we integrate into the UI the ability to change them.
        self.ast.recast(&Default::default(), 0)
    }

    pub fn recast_with_options(&self, options: &FormatOptions) -> String {
        self.ast.recast(options, 0)
    }
}

impl From<ast::types::Node<ast::types::Program>> for Program {
    fn from(ast: ast::types::Node<ast::types::Program>) -> Program {
        Self { ast }
    }
}
