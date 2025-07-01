//! The servers that power the text editor.

pub mod backend;
pub mod copilot;
pub mod kcl;
#[cfg(any(test, feature = "lsp-test-util"))]
pub mod test_util;
#[cfg(test)]
mod tests;
pub mod util;

use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity, DiagnosticTag};
pub use util::IntoDiagnostic;

use crate::{
    CompilationError,
    errors::{Severity, Tag},
};

impl IntoDiagnostic for CompilationError {
    fn to_lsp_diagnostics(&self, code: &str) -> Vec<Diagnostic> {
        let edit = self.suggestion.as_ref().map(|s| s.to_lsp_edit(code));

        vec![Diagnostic {
            range: self.source_range.to_lsp_range(code),
            severity: Some(self.severity()),
            code: None,
            code_description: None,
            source: Some("kcl".to_string()),
            message: self.message.clone(),
            related_information: None,
            tags: self.tag.to_lsp_tags(),
            data: edit.map(|e| serde_json::to_value(e).unwrap()),
        }]
    }

    fn severity(&self) -> DiagnosticSeverity {
        match self.severity {
            Severity::Warning => DiagnosticSeverity::WARNING,
            _ => DiagnosticSeverity::ERROR,
        }
    }
}

impl Tag {
    fn to_lsp_tags(self) -> Option<Vec<DiagnosticTag>> {
        match self {
            Tag::Deprecated => Some(vec![DiagnosticTag::DEPRECATED]),
            Tag::Unnecessary => Some(vec![DiagnosticTag::UNNECESSARY]),
            Tag::UnknownNumericUnits | Tag::None => None,
        }
    }
}
