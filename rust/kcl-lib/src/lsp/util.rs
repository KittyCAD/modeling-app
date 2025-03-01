//! Utility functions for working with ropes and positions.

use ropey::Rope;
use tower_lsp::lsp_types::{Diagnostic, Position};

pub fn position_to_offset(position: Position, rope: &Rope) -> Option<usize> {
    Some(rope.try_line_to_char(position.line as usize).ok()? + position.character as usize)
}

pub fn get_text_before(offset: usize, rope: &Rope) -> Option<String> {
    if offset == 0 {
        return Some("".to_string());
    }
    Some(rope.slice(0..offset).to_string())
}

pub fn get_text_after(offset: usize, rope: &Rope) -> Option<String> {
    let end_idx = rope.len_chars();
    if offset == end_idx {
        return Some("".to_string());
    }
    Some(rope.slice(offset..end_idx).to_string())
}

pub fn get_line_before(pos: Position, rope: &Rope) -> Option<String> {
    let char_offset = pos.character as usize;
    let offset = position_to_offset(pos, rope).unwrap();
    if char_offset == 0 {
        return Some("".to_string());
    }
    let line_start = offset - char_offset;
    Some(rope.slice(line_start..offset).to_string())
}

/// Convert an object into a [lsp_types::Diagnostic] given the
/// [TextDocumentItem]'s `.text` field.
pub trait IntoDiagnostic {
    /// Convert the traited object to a vector of [lsp_types::Diagnostic].
    fn to_lsp_diagnostics(&self, text: &str) -> Vec<Diagnostic>;

    /// Get the severity of the diagnostic.
    fn severity(&self) -> tower_lsp::lsp_types::DiagnosticSeverity;
}
