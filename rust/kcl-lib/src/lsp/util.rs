//! Utility functions for working with ropes and positions.

use tower_lsp::lsp_types::Diagnostic;

/// Convert an object into a [lsp_types::Diagnostic] given the
/// [TextDocumentItem]'s `.text` field.
pub trait IntoDiagnostic {
    /// Convert the traited object to a vector of [lsp_types::Diagnostic].
    fn to_lsp_diagnostics(&self, text: &str) -> Vec<Diagnostic>;

    /// Get the severity of the diagnostic.
    fn severity(&self) -> tower_lsp::lsp_types::DiagnosticSeverity;
}
