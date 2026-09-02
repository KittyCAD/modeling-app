use thiserror::Error;

/// This is the tolerance that the engine's toolpaths repo uses for
/// checking if two points are coincident. Must be changed in the future,
/// the client should really be in control of determining when two points
/// are coincident.
pub(super) const CONTACT_TOLERANCE: f64 = crate::std::solver::SOLVER_CONVERGENCE_TOLERANCE;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct SketchVisualizationBounds {
    pub(super) min: SketchVisualizationPoint,
    pub(super) max: SketchVisualizationPoint,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct SketchVisualizationPoint {
    pub(super) x: f64,
    pub(super) y: f64,
}

#[derive(Debug, Error)]
pub enum SketchVisualizationError {
    #[error("no sketch named `{name}` was found in the execution outcome")]
    SketchNotFound { name: String },
    #[error("found {count} sketches named `{name}` in the execution outcome")]
    AmbiguousSketchName { name: String, count: usize },
    #[error("sketch `{sketch_name}` has no segment named `{segment_name}`")]
    SegmentNotFound { sketch_name: String, segment_name: String },
    #[error("segment `{segment_name}` in sketch `{sketch_name}` was not solved")]
    SegmentNotSolved { sketch_name: String, segment_name: String },
    #[error("no region named `{name}` was found in the execution outcome")]
    RegionNotFound { name: String },
    #[error("`{name}` is not a resolved region")]
    NotARegion { name: String },
    #[error("region `{region_name}` was resolved from a different sketch than `{sketch_name}`")]
    RegionSketchMismatch { sketch_name: String, region_name: String },
    #[error("region `{region_name}` has no resolved boundary segments in the artifact graph")]
    RegionBoundaryNotFound { region_name: String },
    #[error("object id {id} was missing from the execution scene objects")]
    MissingObject { id: usize },
    #[error("failed to encode sketch visualization PNG: {0}")]
    Image(#[from] image::ImageError),
}
