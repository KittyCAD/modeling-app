use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::{Position as LspPosition, Range as LspRange};

/// Identifier of a source file.  Uses a u32 to keep the size small.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct ModuleId(u32);

impl ModuleId {
    pub fn from_usize(id: usize) -> Self {
        Self(u32::try_from(id).expect("module ID should fit in a u32"))
    }

    pub fn as_usize(&self) -> usize {
        usize::try_from(self.0).expect("module ID should fit in a usize")
    }

    /// Top-level file is the one being executed.
    /// Represented by module ID of 0, i.e. the default value.
    pub fn is_top_level(&self) -> bool {
        *self == Self::default()
    }
}

#[derive(Debug, Default, Deserialize, Serialize, PartialEq, Copy, Clone, ts_rs::TS, JsonSchema, Hash, Eq)]
#[ts(export, type = "[number, number, number]")]
pub struct SourceRange([usize; 3]);

impl From<[usize; 3]> for SourceRange {
    fn from(value: [usize; 3]) -> Self {
        Self(value)
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

    /// Get the end of the range.
    pub fn end(&self) -> usize {
        self.0[1]
    }

    /// Get the module ID of the range.
    pub fn module_id(&self) -> ModuleId {
        ModuleId::from_usize(self.0[2])
    }

    /// Check if the range contains a position.
    pub fn contains(&self, pos: usize) -> bool {
        pos >= self.start() && pos <= self.end()
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
