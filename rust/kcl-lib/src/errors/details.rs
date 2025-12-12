//! This module exists to disable the unused_assignments warnings at the module
//! level to work around the miette macro issue.
//! https://github.com/zkat/miette/issues/458
#![expect(unused_assignments, reason = "miette macros trigger false positives")]

use kcl_error::SourceRange;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, ts_rs::TS, Clone, PartialEq, Eq, thiserror::Error, miette::Diagnostic)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
#[ts(export)]
pub struct KclErrorDetails {
    #[label(collection, "Errors")]
    pub source_ranges: Vec<SourceRange>,
    pub backtrace: Vec<super::BacktraceItem>,
    #[serde(rename = "msg")]
    pub message: String,
}
