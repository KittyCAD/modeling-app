//! Custom notifications for the KCL LSP server that are not part of the LSP specification.

use tower_lsp::lsp_types::notification::Notification;

/// A notification that the AST has changed.
#[derive(Debug)]
pub enum AstUpdated {}

impl Notification for AstUpdated {
    type Params = crate::ast::types::Program;
    const METHOD: &'static str = "kcl/astUpdated";
}

/// A notification that the Memory has changed.
#[derive(Debug)]
pub enum MemoryUpdated {}

impl Notification for MemoryUpdated {
    type Params = crate::executor::ProgramMemory;
    const METHOD: &'static str = "kcl/memoryUpdated";
}
