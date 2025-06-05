use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::{Position as LspPosition, Range as LspRange};

use crate::modules::ModuleId;

/// The first two items are the start and end points (byte offsets from the start of the file).
/// The third item is whether the source range belongs to the 'main' file, i.e., the file currently
/// being rendered/displayed in the editor.
//
// Don't use a doc comment for the below since the above goes in the website docs.
// @see isTopLevelModule() in wasm.ts.
// TODO we need to handle modules better in the frontend.
#[derive(Debug, Default, Deserialize, Serialize, PartialEq, Copy, Clone, ts_rs::TS, JsonSchema, Hash, Eq)]
#[ts(export, type = "[number, number, number]")]
pub struct SourceRange([usize; 3]);

impl From<[usize; 3]> for SourceRange {
    fn from(value: [usize; 3]) -> Self {
        Self(value)
    }
}

impl Ord for SourceRange {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Sort by module id first, then by start and end.
        let module_id_cmp = self.module_id().cmp(&other.module_id());
        if module_id_cmp != std::cmp::Ordering::Equal {
            return module_id_cmp;
        }
        let start_cmp = self.start().cmp(&other.start());
        if start_cmp != std::cmp::Ordering::Equal {
            return start_cmp;
        }
        self.end().cmp(&other.end())
    }
}

impl PartialOrd for SourceRange {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl From<&SourceRange> for miette::SourceSpan {
    fn from(source_range: &SourceRange) -> Self {
        let length = source_range.end() - source_range.start();
        let start = miette::SourceOffset::from(source_range.start());
        Self::new(start, length)
    }
}

impl From<SourceRange> for miette::SourceSpan {
    fn from(source_range: SourceRange) -> Self {
        Self::from(&source_range)
    }
}

impl SourceRange {
    /// Create a new source range.
    pub fn new(start: usize, end: usize, module_id: ModuleId) -> Self {
        Self([start, end, module_id.as_usize()])
    }

    /// A source range that doesn't correspond to any source code.
    pub fn synthetic() -> Self {
        Self::default()
    }

    /// True if this is a source range that doesn't correspond to any source
    /// code.
    pub fn is_synthetic(&self) -> bool {
        self.start() == 0 && self.end() == 0
    }

    /// Get the start of the range.
    pub fn start(&self) -> usize {
        self.0[0]
    }

    /// Get the start of the range as a zero-length SourceRange, effectively collapse `self` to it's
    /// start.
    pub fn start_as_range(&self) -> Self {
        Self([self.0[0], self.0[0], self.0[2]])
    }

    /// Get the end of the range.
    pub fn end(&self) -> usize {
        self.0[1]
    }

    /// Get the module ID of the range.
    pub fn module_id(&self) -> ModuleId {
        ModuleId::from_usize(self.0[2])
    }

    /// True if this source range is from the top-level module.
    pub fn is_top_level_module(&self) -> bool {
        self.module_id().is_top_level()
    }

    /// Check if the range contains a position.
    pub fn contains(&self, pos: usize) -> bool {
        pos >= self.start() && pos <= self.end()
    }

    /// Check if the range contains another range.  Modules must match.
    pub(crate) fn contains_range(&self, other: &Self) -> bool {
        self.module_id() == other.module_id() && self.start() <= other.start() && self.end() >= other.end()
    }

    pub fn start_to_lsp_position(&self, code: &str) -> LspPosition {
        // Calculate the line and column of the error from the source range.
        // Lines are zero indexed in vscode so we need to subtract 1.
        let mut line = code.get(..self.start()).unwrap_or_default().lines().count();
        if line > 0 {
            line = line.saturating_sub(1);
        }
        let column = code[..self.start()].lines().last().map(|l| l.len()).unwrap_or_default();

        LspPosition {
            line: line as u32,
            character: column as u32,
        }
    }

    pub fn end_to_lsp_position(&self, code: &str) -> LspPosition {
        let lines = code.get(..self.end()).unwrap_or_default().lines();
        if lines.clone().count() == 0 {
            return LspPosition { line: 0, character: 0 };
        }

        // Calculate the line and column of the error from the source range.
        // Lines are zero indexed in vscode so we need to subtract 1.
        let line = lines.clone().count() - 1;
        let column = lines.last().map(|l| l.len()).unwrap_or_default();

        LspPosition {
            line: line as u32,
            character: column as u32,
        }
    }

    pub fn to_lsp_range(&self, code: &str) -> LspRange {
        let start = self.start_to_lsp_position(code);
        let end = self.end_to_lsp_position(code);
        LspRange { start, end }
    }
}
