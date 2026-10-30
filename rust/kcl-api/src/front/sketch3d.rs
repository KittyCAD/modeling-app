use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::SourceRef;

/// Solved world-space geometry. Coordinates are always in millimeters.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Sketch3d {
    pub segments: Vec<Segment3d>,
    pub constraints: Vec<Constraint3d>,
    pub degrees_of_freedom: usize,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Segment3d {
    pub label: String,
    pub kind: String,
    pub points: Vec<[f64; 3]>,
    pub normal: Option<[f64; 3]>,
    pub clockwise: bool,
    pub construction: bool,
    pub source: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Constraint3d {
    pub kind: String,
    pub source: SourceRef,
}
