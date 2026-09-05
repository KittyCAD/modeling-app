//! Static PNG rendering for sketches produced by KCL execution.

mod api;
mod extract;
mod model;
mod region;
mod render;
mod sampling;
mod scene;
mod types;

#[cfg(test)]
mod tests;

pub(crate) use api::render_sketch_png;
pub use region::ResolvedSketchRegion;
pub use types::SketchVisualizationError;
