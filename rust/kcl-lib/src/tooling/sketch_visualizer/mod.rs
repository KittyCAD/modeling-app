//! Static 2D sketch visualization for non-frontend consumers.
//!
//! This module renders the sketch scene objects produced by KCL execution into
//! a plain PNG and a JSON-friendly sidecar model. It is intentionally a debug
//! visualizer, not a port of the interactive sketch-mode UI.
//!
//! The visualizer has three phases:
//! 1. select a sketch and extract frontend scene objects into a small internal
//!    point/segment model;
//! 2. derive sidecar facts such as DoF buckets, contact groups, constraint
//!    groups, connected components, and deterministic ID colors;
//! 3. rasterize the already-sampled polylines into a deterministic PNG.
//!
//! Keeping those phases explicit makes the image useful for humans while the
//! sidecar stays stable enough for CLI, MCP, and tests to inspect directly.

mod api;
mod connectivity;
mod constraints;
mod extract;
mod model;
mod render;
mod sampling;
mod scene;
mod types;

#[cfg(test)]
mod tests;

pub use api::visualize_scene_objects;
pub use types::{
    SketchSelector, SketchVisualization, SketchVisualizationBounds, SketchVisualizationClosednessHint,
    SketchVisualizationCoincidentGroup, SketchVisualizationColorScheme, SketchVisualizationConnectedComponent,
    SketchVisualizationConstraintData, SketchVisualizationConstraintTarget, SketchVisualizationData,
    SketchVisualizationDofBuckets, SketchVisualizationDofData, SketchVisualizationError, SketchVisualizationOptions,
    SketchVisualizationPoint, SketchVisualizationPointData, SketchVisualizationPointGroup,
    SketchVisualizationSegmentData, SketchVisualizationSegmentKind, SketchVisualizationSketchInfo,
    SketchVisualizationTheme,
};
