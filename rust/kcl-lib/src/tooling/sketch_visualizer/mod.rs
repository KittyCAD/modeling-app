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
mod mode;
mod model;
mod render;
mod sampling;
mod scene;
mod sharp_tangents;
mod types;

#[cfg(test)]
mod tests;

pub use api::visualize_scene_objects;
pub use types::SketchSelector;
pub use types::SketchVisualization;
pub use types::SketchVisualizationBounds;
pub use types::SketchVisualizationClosednessHint;
pub use types::SketchVisualizationCoincidentGroup;
pub use types::SketchVisualizationConnectedComponent;
pub use types::SketchVisualizationConstraintData;
pub use types::SketchVisualizationConstraintTarget;
pub use types::SketchVisualizationData;
pub use types::SketchVisualizationDofBuckets;
pub use types::SketchVisualizationDofData;
pub use types::SketchVisualizationError;
pub use types::SketchVisualizationMode;
pub use types::SketchVisualizationOptions;
pub use types::SketchVisualizationPoint;
pub use types::SketchVisualizationPointData;
pub use types::SketchVisualizationPointGroup;
pub use types::SketchVisualizationSegmentData;
pub use types::SketchVisualizationSegmentKind;
pub use types::SketchVisualizationSharpTangentData;
pub use types::SketchVisualizationSharpTangentIncident;
pub use types::SketchVisualizationSketchInfo;
pub use types::SketchVisualizationTheme;
