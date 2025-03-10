//! Rust support for KCL (aka the KittyCAD Language).
//!
//! KCL is written in Rust. This crate contains the compiler tooling (e.g. parser, lexer, code generation),
//! the standard library implementation, a LSP implementation, generator for the docs, and more.
#![recursion_limit = "1024"]
#![allow(clippy::boxed_local)]

#[allow(unused_macros)]
macro_rules! println {
    ($($rest:tt)*) => {
        #[cfg(feature = "disable-println")]
        {
            let _ = format!($($rest)*);
        }
        #[cfg(not(feature = "disable-println"))]
        std::println!($($rest)*)
    }
}

#[allow(unused_macros)]
macro_rules! eprintln {
    ($($rest:tt)*) => {
        #[cfg(feature = "disable-println")]
        {
            let _ = format!($($rest)*);
        }
        #[cfg(not(feature = "disable-println"))]
        std::eprintln!($($rest)*)
    }
}

#[allow(unused_macros)]
macro_rules! print {
    ($($rest:tt)*) => {
        #[cfg(feature = "disable-println")]
        {
            let _ = format!($($rest)*);
        }
        #[cfg(not(feature = "disable-println"))]
        std::print!($($rest)*)
    }
}

#[allow(unused_macros)]
macro_rules! eprint {
    ($($rest:tt)*) => {
        #[cfg(feature = "disable-println")]
        {
            let _ = format!($($rest)*);
        }
        #[cfg(not(feature = "disable-println"))]
        std::eprint!($($rest)*)
    }
}
#[cfg(feature = "dhat-heap")]
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

mod coredump;
mod docs;
mod engine;
mod errors;
mod execution;
mod fs;
pub mod lint;
mod log;
mod lsp;
mod modules;
mod parsing;
mod settings;
#[cfg(test)]
mod simulation_tests;
mod source_range;
pub mod std;
#[cfg(not(target_arch = "wasm32"))]
pub mod test_server;
mod thread;
mod unparser;
mod walk;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use coredump::CoreDump;
pub use engine::{EngineManager, ExecutionKind};
pub use errors::{
    CompilationError, ConnectionError, ExecError, KclError, KclErrorWithOutputs, Report, ReportWithOutputs,
};
pub use execution::{
    bust_cache, clear_mem_cache, ExecOutcome, ExecState, ExecutorContext, ExecutorSettings, MetaSettings, Point2d,
};
pub use lsp::{
    copilot::Backend as CopilotLspBackend,
    kcl::{Backend as KclLspBackend, Server as KclLspServerSubCommand},
};
pub use modules::ModuleId;
pub use parsing::ast::{modify::modify_ast_for_sketch, types::FormatOptions};
pub use settings::types::{project::ProjectConfiguration, Configuration, UnitLength};
pub use source_range::SourceRange;

// Rather than make executor public and make lots of it pub(crate), just re-export into a new module.
// Ideally we wouldn't export these things at all, they should only be used for testing.
pub mod exec {
    pub use crate::execution::{ArtifactCommand, DefaultPlanes, IdGenerator, KclValue, PlaneType, Sketch};
}

#[cfg(target_arch = "wasm32")]
pub mod wasm_engine {
    pub use crate::{
        coredump::wasm::{CoreDumpManager, CoreDumper},
        engine::conn_wasm::{EngineCommandManager, EngineConnection},
        fs::wasm::FileSystemManager,
    };
}

#[cfg(not(target_arch = "wasm32"))]
pub mod native_engine {
    pub use crate::engine::conn::EngineConnection;
}

pub mod std_utils {
    pub use crate::std::utils::{get_tangential_arc_to_info, is_points_ccw_wasm, TangentialArcInfoInput};
}

pub mod pretty {
    pub use crate::{parsing::token::NumericSuffix, unparser::format_number};
}

use serde::{Deserialize, Serialize};

#[allow(unused_imports)]
use crate::log::{log, logln};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Program {
    #[serde(flatten)]
    pub ast: parsing::ast::types::Node<parsing::ast::types::Program>,
    // The ui doesn't need to know about this.
    // It's purely used for saving the contents of the original file, so we can use it for errors.
    // Because in the case of the root file, we don't want to read the file from disk again.
    #[serde(skip)]
    pub original_file_contents: String,
}

#[cfg(any(test, feature = "lsp-test-util"))]
pub use lsp::test_util::copilot_lsp_server;
#[cfg(any(test, feature = "lsp-test-util"))]
pub use lsp::test_util::kcl_lsp_server;

impl Program {
    pub fn parse(input: &str) -> Result<(Option<Program>, Vec<CompilationError>), KclError> {
        let module_id = ModuleId::default();
        let tokens = parsing::token::lex(input, module_id)?;
        let (ast, errs) = parsing::parse_tokens(tokens).0?;

        Ok((
            ast.map(|ast| Program {
                ast,
                original_file_contents: input.to_string(),
            }),
            errs,
        ))
    }

    pub fn parse_no_errs(input: &str) -> Result<Program, KclError> {
        let module_id = ModuleId::default();
        let tokens = parsing::token::lex(input, module_id)?;
        let ast = parsing::parse_tokens(tokens).parse_errs_as_err()?;

        Ok(Program {
            ast,
            original_file_contents: input.to_string(),
        })
    }

    pub fn compute_digest(&mut self) -> parsing::ast::digest::Digest {
        self.ast.compute_digest()
    }

    /// Get the meta settings for the kcl file from the annotations.
    pub fn meta_settings(&self) -> Result<Option<crate::MetaSettings>, KclError> {
        self.ast.meta_settings()
    }

    /// Change the meta settings for the kcl file.
    pub fn change_meta_settings(&self, settings: crate::MetaSettings) -> Result<Self, KclError> {
        Ok(Self {
            ast: self.ast.change_meta_settings(settings)?,
            original_file_contents: self.original_file_contents.clone(),
        })
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

#[inline]
fn try_f64_to_usize(f: f64) -> Option<usize> {
    let i = f as usize;
    if i as f64 == f {
        Some(i)
    } else {
        None
    }
}

#[inline]
fn try_f64_to_u32(f: f64) -> Option<u32> {
    let i = f as u32;
    if i as f64 == f {
        Some(i)
    } else {
        None
    }
}

#[inline]
fn try_f64_to_u64(f: f64) -> Option<u64> {
    let i = f as u64;
    if i as f64 == f {
        Some(i)
    } else {
        None
    }
}

#[inline]
fn try_f64_to_i64(f: f64) -> Option<i64> {
    let i = f as i64;
    if i as f64 == f {
        Some(i)
    } else {
        None
    }
}

/// Get the version of the KCL library.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn convert_int() {
        assert_eq!(try_f64_to_usize(0.0), Some(0));
        assert_eq!(try_f64_to_usize(42.0), Some(42));
        assert_eq!(try_f64_to_usize(0.00000000001), None);
        assert_eq!(try_f64_to_usize(-1.0), None);
        assert_eq!(try_f64_to_usize(f64::NAN), None);
        assert_eq!(try_f64_to_usize(f64::INFINITY), None);
        assert_eq!(try_f64_to_usize((0.1 + 0.2) * 10.0), None);

        assert_eq!(try_f64_to_u32(0.0), Some(0));
        assert_eq!(try_f64_to_u32(42.0), Some(42));
        assert_eq!(try_f64_to_u32(0.00000000001), None);
        assert_eq!(try_f64_to_u32(-1.0), None);
        assert_eq!(try_f64_to_u32(f64::NAN), None);
        assert_eq!(try_f64_to_u32(f64::INFINITY), None);
        assert_eq!(try_f64_to_u32((0.1 + 0.2) * 10.0), None);

        assert_eq!(try_f64_to_u64(0.0), Some(0));
        assert_eq!(try_f64_to_u64(42.0), Some(42));
        assert_eq!(try_f64_to_u64(0.00000000001), None);
        assert_eq!(try_f64_to_u64(-1.0), None);
        assert_eq!(try_f64_to_u64(f64::NAN), None);
        assert_eq!(try_f64_to_u64(f64::INFINITY), None);
        assert_eq!(try_f64_to_u64((0.1 + 0.2) * 10.0), None);

        assert_eq!(try_f64_to_i64(0.0), Some(0));
        assert_eq!(try_f64_to_i64(42.0), Some(42));
        assert_eq!(try_f64_to_i64(0.00000000001), None);
        assert_eq!(try_f64_to_i64(-1.0), Some(-1));
        assert_eq!(try_f64_to_i64(f64::NAN), None);
        assert_eq!(try_f64_to_i64(f64::INFINITY), None);
        assert_eq!(try_f64_to_i64((0.1 + 0.2) * 10.0), None);
    }
}
