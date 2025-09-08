//! The servers that power the text editor.

pub mod backend;
pub mod copilot;
pub mod kcl;
#[cfg(any(test, feature = "lsp-test-util"))]
pub mod test_util;
#[cfg(test)]
mod tests;
pub mod util;

use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity, DiagnosticTag, Position, Range};
pub use util::IntoDiagnostic;

use crate::{
    CompilationError,
    errors::{Severity, Suggestion, Tag},
};

impl IntoDiagnostic for CompilationError {
    fn to_lsp_diagnostics(&self, code: &str) -> Vec<Diagnostic> {
        let edit = self.suggestion.as_ref().map(|s| to_lsp_edit(s, code));

        vec![Diagnostic {
            range: self.source_range.to_lsp_range(code),
            severity: Some(self.severity()),
            code: None,
            code_description: None,
            source: Some("kcl".to_string()),
            message: self.message.clone(),
            related_information: None,
            tags: tag_to_lsp_tags(self.tag),
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

fn tag_to_lsp_tags(tag: Tag) -> Option<Vec<DiagnosticTag>> {
    match tag {
        Tag::Deprecated => Some(vec![DiagnosticTag::DEPRECATED]),
        Tag::Unnecessary => Some(vec![DiagnosticTag::UNNECESSARY]),
        Tag::UnknownNumericUnits | Tag::None => None,
    }
}

pub type LspSuggestion = (Suggestion, tower_lsp::lsp_types::Range);

pub(crate) fn to_lsp_edit(suggestion: &Suggestion, code: &str) -> LspSuggestion {
    let range = suggestion.source_range.to_lsp_range(code);
    (suggestion.clone(), range)
}

pub trait ToLspRange {
    fn to_lsp_range(&self, code: &str) -> Range {
        let start = self.start_to_lsp_position(code);
        let end = self.end_to_lsp_position(code);
        Range { start, end }
    }

    fn start_to_lsp_position(&self, code: &str) -> Position;
    fn end_to_lsp_position(&self, code: &str) -> Position;
}

impl ToLspRange for crate::SourceRange {
    fn start_to_lsp_position(&self, code: &str) -> Position {
        // Calculate the line and column of the error from the source range.
        // Lines are zero indexed in vscode so we need to subtract 1.
        let mut line = code.get(..self.start()).unwrap_or_default().lines().count();
        if line > 0 {
            line = line.saturating_sub(1);
        }
        let column = code[..self.start()].lines().last().map(|l| l.len()).unwrap_or_default();

        Position {
            line: line as u32,
            character: column as u32,
        }
    }

    fn end_to_lsp_position(&self, code: &str) -> Position {
        let lines = code.get(..self.end()).unwrap_or_default().lines();
        if lines.clone().count() == 0 {
            return Position { line: 0, character: 0 };
        }

        // Calculate the line and column of the error from the source range.
        // Lines are zero indexed in vscode so we need to subtract 1.
        let line = lines.clone().count() - 1;
        let column = lines.last().map(|l| l.len()).unwrap_or_default();

        Position {
            line: line as u32,
            character: column as u32,
        }
    }
}
