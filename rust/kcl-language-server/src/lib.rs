//! Language Server Protocol implementations used by KCL editors.

mod lsp;

pub(crate) use kcl_lib::ModuleId;
pub(crate) use kcl_lib::Program;
pub(crate) use kcl_lib::SourceRange;
pub(crate) use kcl_lib::bust_cache;
pub(crate) use kcl_lib::exec;
pub(crate) use kcl_lib::lsp_support::docs;
pub(crate) use kcl_lib::lsp_support::errors;
pub(crate) use kcl_lib::lsp_support::execution;
pub(crate) use kcl_lib::lsp_support::fs;
pub(crate) use kcl_lib::lsp_support::parsing;
pub(crate) use kcl_lib::walk;
pub use lsp::copilot::Backend as CopilotLspBackend;
pub use lsp::kcl::Backend as KclLspBackend;
pub use lsp::kcl::Server as KclLspServerSubCommand;
#[cfg(any(test, feature = "lsp-test-util"))]
pub use lsp::test_util::copilot_lsp_server;
#[cfg(any(test, feature = "lsp-test-util"))]
pub use lsp::test_util::kcl_lsp_server;
