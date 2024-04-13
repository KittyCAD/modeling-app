//! Custom notifications for the KCL LSP server that are not part of the LSP specification.

use tower_lsp::lsp_types::notification::Notification;

/// A notification that the AST has changed.
#[derive(Debug)]
pub enum AstChanged {}

impl Notification for AstChanged {
    type Params = crate::ast::types::Program;
    const METHOD: &'static str = "kcl/astChanged";
}

/// A notification that the Memory has changed.
#[derive(Debug)]
pub enum MemoryChanged {}

impl Notification for MemoryChanged {
    type Params = crate::executor::ProgramMemory;
    const METHOD: &'static str = "kcl/memoryChanged";
}
