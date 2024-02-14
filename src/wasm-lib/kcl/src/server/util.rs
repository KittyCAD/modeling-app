//! Utility functions for working with ropes and positions.

use ropey::Rope;
use tower_lsp::lsp_types::Position;

pub fn offset_to_position(offset: usize, rope: &Rope) -> Option<Position> {
    let line = rope.try_char_to_line(offset).ok()?;
    let first_char_of_line = rope.try_line_to_char(line).ok()?;
    let column = offset - first_char_of_line;
    Some(Position::new(line as u32, column as u32))
}

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

pub struct DocumentCompletionParams {
    pub prefix: String,
    pub prompt: String,
    pub suffix: String,
    pub line_before: String,
}

impl DocumentCompletionParams {
    pub fn new(uri: String, position: Position, rope: Rope) -> Self {
        let line_before = get_line_before(position, &rope).unwrap_or_default();
        let offset = position_to_offset(position, &rope).unwrap_or_default();
        let prefix = get_text_before(offset, &rope).unwrap_or_default();
        let prompt = format!("// Path: {}\n{}", uri, prefix);
        let suffix = get_text_after(offset, &rope).unwrap();
        Self {
            prefix,
            prompt,
            suffix,
            line_before,
        }
    }
}
