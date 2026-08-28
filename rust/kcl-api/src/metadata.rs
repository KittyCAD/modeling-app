use kcl_error::SourceRange;
use serde::Deserialize;
use serde::Serialize;

/// Metadata.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, Eq, Copy)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    /// The source range.
    pub source_range: SourceRange,
}

impl From<Metadata> for Vec<SourceRange> {
    fn from(meta: Metadata) -> Self {
        vec![meta.source_range]
    }
}

impl From<&Metadata> for SourceRange {
    fn from(meta: &Metadata) -> Self {
        meta.source_range
    }
}

impl From<SourceRange> for Metadata {
    fn from(source_range: SourceRange) -> Self {
        Self { source_range }
    }
}
