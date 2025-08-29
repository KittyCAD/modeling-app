use std::fmt;

use serde::{Deserialize, Serialize};

/// Identifier of a source file.  Uses a u32 to keep the size small.
#[derive(Debug, Default, Ord, PartialOrd, Eq, PartialEq, Clone, Copy, Hash, Deserialize, Serialize, ts_rs::TS)]
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

impl std::fmt::Display for ModuleId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// The first two items are the start and end points (byte offsets from the start of the file).
/// The third item is whether the source range belongs to the 'main' file, i.e., the file currently
/// being rendered/displayed in the editor.
//
// Don't use a doc comment for the below since the above goes in the website docs.
// @see isTopLevelModule() in wasm.ts.
// TODO we need to handle modules better in the frontend.
#[derive(Debug, Default, Deserialize, Serialize, PartialEq, Copy, Clone, ts_rs::TS, Hash, Eq)]
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

    pub fn merge(mut ranges: impl Iterator<Item = SourceRange>) -> Self {
        let mut result = ranges.next().unwrap_or_default();

        for r in ranges {
            debug_assert!(r.0[2] == result.0[2], "Merging source ranges from different files");
            if r.0[0] < result.0[0] {
                result.0[0] = r.0[0]
            }
            if r.0[1] > result.0[1] {
                result.0[1] = r.0[1];
            }
        }

        result
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
    pub fn contains_range(&self, other: &Self) -> bool {
        self.module_id() == other.module_id() && self.start() <= other.start() && self.end() >= other.end()
    }
}
