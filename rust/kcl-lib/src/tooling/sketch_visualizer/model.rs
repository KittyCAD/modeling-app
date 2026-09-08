//! Internal, render-oriented shape model.

use super::types::SketchVisualizationPoint;
use crate::front::Freedom;

#[derive(Debug, Clone)]
pub(super) struct InternalPoint {
    pub(super) position: SketchVisualizationPoint,
    pub(super) owner: Option<usize>,
    pub(super) freedom: Freedom,
}

#[derive(Debug, Clone)]
pub(super) struct InternalSegment {
    pub(super) construction: bool,
    pub(super) freedom: Option<Freedom>,
    pub(super) polyline: Vec<SketchVisualizationPoint>,
}
