//! Internal, render-oriented shape model.

use kcl_api::Freedom;

use super::types::SketchVisualizationPoint;

#[derive(Debug, Clone)]
pub(super) struct InternalPoint {
    pub(super) position: SketchVisualizationPoint,
    pub(super) freedom: Freedom,
}

#[derive(Debug, Clone)]
pub(super) struct InternalSegment {
    pub(super) construction: bool,
    pub(super) freedom: Option<Freedom>,
    pub(super) polyline: Vec<SketchVisualizationPoint>,
}
