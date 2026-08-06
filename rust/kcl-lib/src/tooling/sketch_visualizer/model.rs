use std::collections::BTreeMap;

use crate::front::Freedom;

use super::types::SketchVisualizationClosednessHint;
use super::types::SketchVisualizationConnectedComponent;
use super::types::SketchVisualizationPoint;
use super::types::SketchVisualizationSegmentKind;

#[derive(Debug, Clone)]
pub(super) struct InternalPoint {
    pub(super) id: usize,
    pub(super) position: SketchVisualizationPoint,
    pub(super) owner: Option<usize>,
    pub(super) freedom: Freedom,
}

#[derive(Debug, Clone)]
pub(super) struct InternalSegment {
    pub(super) id: usize,
    pub(super) kind: SketchVisualizationSegmentKind,
    pub(super) point_ids: Vec<usize>,
    pub(super) endpoint_ids: Vec<usize>,
    pub(super) construction: bool,
    pub(super) freedom: Option<Freedom>,
    pub(super) polylines: Vec<Vec<SketchVisualizationPoint>>,
}

#[derive(Debug, Clone)]
pub(super) struct InternalPolyline {
    pub(super) points: Vec<SketchVisualizationPoint>,
    pub(super) dashed: bool,
}

#[derive(Debug, Clone)]
pub(super) struct ComponentResult {
    pub(super) components: Vec<SketchVisualizationConnectedComponent>,
    pub(super) segment_to_component: BTreeMap<usize, usize>,
    pub(super) open_endpoints: Vec<usize>,
    pub(super) closedness_hints: Vec<SketchVisualizationClosednessHint>,
}
