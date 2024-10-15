//! Functions for calling into the engine-utils library (a set of C++ utilities containing various logic for client-side CAD processing)
//! Note that this binary may not be available to all builds of kcl, so fallbacks that call the engine API should be implemented

use crate::{
    errors::{KclError, KclErrorDetails},
    std::Args,
};
use anyhow::Result;

pub fn is_available() -> bool {
    false
}

pub async fn get_true_path_end_pos(_sketch: String, args: &Args) -> Result<String, KclError> {
    Err(KclError::Internal(KclErrorDetails {
        message: "Engine utils not yet implemented".into(),
        source_ranges: vec![args.source_range],
    }))
}
