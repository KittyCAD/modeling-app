//! Static 2D sketch visualization for non-frontend consumers.
//!
//! This module renders the sketch scene objects produced by KCL execution into
//! a plain PNG and a JSON-friendly sidecar model. It is intentionally a debug
//! visualizer, not a port of the interactive sketch-mode UI.

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
