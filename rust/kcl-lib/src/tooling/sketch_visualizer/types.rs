use thiserror::Error;

const DEFAULT_WIDTH: u32 = 1024;
const DEFAULT_HEIGHT: u32 = 1024;
const DEFAULT_PADDING: u32 = 48;
/// This is the tolerance that the engine's toolpaths repo uses for
/// checking if two points are coincident. Must be changed in the future,
/// the client should really be in control of determining when two points
/// are coincident.
pub(super) const CONTACT_TOLERANCE: f64 = crate::std::solver::SOLVER_CONVERGENCE_TOLERANCE;

#[derive(Debug, Clone, PartialEq)]
pub(super) struct SketchVisualizationOptions {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) padding: u32,
}

impl Default for SketchVisualizationOptions {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            padding: DEFAULT_PADDING,
        }
    }
}

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SketchVisualizationSegmentKind {
    Point,
    Line,
    Arc,
    Circle,
    ControlPointSpline,
}

#[derive(Debug, Error)]
pub enum SketchVisualizationError {
    #[error("no sketch named `{name}` was found in the execution outcome")]
    SketchNotFound { name: String },
    #[error("found {count} sketches named `{name}` in the execution outcome")]
    AmbiguousSketchName { name: String, count: usize },
    #[error("object id {id} was missing from the execution scene objects")]
    MissingObject { id: usize },
    #[error("object id {id} was expected to be {expected}, found {actual}")]
    UnexpectedObjectKind {
        id: usize,
        expected: &'static str,
        actual: &'static str,
    },
    #[error("invalid visualization canvas: width={width}, height={height}, padding={padding}")]
    InvalidCanvas { width: u32, height: u32, padding: u32 },
    #[error("failed to encode sketch visualization PNG: {0}")]
    Image(#[from] image::ImageError),
}
