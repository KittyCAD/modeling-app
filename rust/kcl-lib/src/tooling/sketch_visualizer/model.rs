//! Internal, render-oriented shape model.
//!
//! The frontend scene graph carries rich constructors, source refs, and ownership
//! relationships. The visualizer collapses that into points, sampled polylines,
//! and graph facts so extraction, connectivity, and rendering do not each need to
//! understand every frontend `Segment` variant.

use std::collections::BTreeMap;

use super::types::SketchVisualizationClosednessHint;
use super::types::SketchVisualizationConnectedComponent;
use super::types::SketchVisualizationPoint;
use super::types::SketchVisualizationSegmentKind;
use crate::front::Freedom;

/// A sketch point with only the fields needed for sidecar JSON and drawing.
#[derive(Debug, Clone)]
pub(super) struct InternalPoint {
    pub(super) id: usize,
    pub(super) position: SketchVisualizationPoint,
    pub(super) owner: Option<usize>,
    pub(super) freedom: Freedom,
}

/// Primary geometry that participates in sidecar connectivity and PNG rendering.
///
/// Curved frontend segments are stored here as sampled polylines. The original
/// `kind`, point IDs, endpoint IDs, construction flag, and DoF state remain
/// attached so the JSON can still describe the source geometry.
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

/// Helper geometry used only for optional control-polygon drawing.
#[derive(Debug, Clone)]
pub(super) struct InternalPolyline {
    pub(super) points: Vec<SketchVisualizationPoint>,
    pub(super) dashed: bool,
}

/// Connectivity facts derived from points and primary segment endpoints.
#[derive(Debug, Clone)]
pub(super) struct ComponentResult {
    pub(super) components: Vec<SketchVisualizationConnectedComponent>,
    pub(super) segment_to_component: BTreeMap<usize, usize>,
    pub(super) open_endpoints: Vec<usize>,
    pub(super) closedness_hints: Vec<SketchVisualizationClosednessHint>,
}
