use serde::{Deserialize, Serialize};

use crate::{Expr, Number, ObjectId, front::Plane};

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiSketch")]
pub struct Sketch {
    pub args: SketchCtor,
    pub plane: ObjectId,
    pub segments: Vec<ObjectId>,
    pub constraints: Vec<ObjectId>,
}

/// Arguments for creating a new sketch. This is similar to the constructor of
/// other kinds of objects in that it is the inputs to the sketch, not the
/// outputs.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct SketchCtor {
    /// The sketch surface.
    pub on: Plane,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiSegment")]
#[serde(tag = "type")]
pub enum Segment {
    Point(Point),
    Line(Line),
    Arc(Arc),
    Circle(Circle),
    ControlPointSpline(ControlPointSpline),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiPoint")]
pub struct Point {
    pub position: Point2d<Number>,
    pub ctor: Option<PointCtor>,
    pub owner: Option<ObjectId>,
    pub freedom: Freedom,
    pub constraints: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiLine")]
pub struct Line {
    pub start: ObjectId,
    pub end: ObjectId,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub owner: Option<ObjectId>,
    // Invariant: Line or MidPointLine
    pub ctor: SegmentCtor,
    // The constructor is applicable if changing the values of the constructor will change the rendering
    // of the segment (modulo multiple valid solutions). I.e., whether the object is constrained with
    // respect to the constructor inputs.
    // The frontend should only display handles for the constructor inputs if the ctor is applicable.
    // (Or because they are the (locked) start/end of the segment).
    pub ctor_applicable: bool,
    pub construction: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiArc")]
pub struct Arc {
    pub start: ObjectId,
    pub end: ObjectId,
    pub center: ObjectId,
    // Invariant: Arc
    pub ctor: SegmentCtor,
    pub ctor_applicable: bool,
    pub construction: bool,
    /// The direction that the arc sweeps from start to end. Omitted when it's
    /// the default, counterclockwise.
    #[serde(default, skip_serializing_if = "ArcDirection::is_ccw")]
    #[ts(as = "Option<ArcDirection>")]
    #[ts(optional)]
    pub direction: ArcDirection,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiCircle")]
pub struct Circle {
    pub start: ObjectId,
    pub center: ObjectId,
    // Invariant: Circle
    pub ctor: SegmentCtor,
    pub ctor_applicable: bool,
    pub construction: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(tag = "type")]
pub enum SegmentCtor {
    Point(PointCtor),
    Line(LineCtor),
    Arc(ArcCtor),
    Circle(CircleCtor),
    ControlPointSpline(ControlPointSplineCtor),
}

impl SegmentCtor {
    /// What kind of geometry is this (point, line, arc, etc)
    /// Suitable for use in user-facing messages.
    pub fn human_friendly_kind_with_article(&self) -> &'static str {
        match self {
            Self::Point(_) => "a Point constructor",
            Self::Line(_) => "a Line constructor",
            Self::Arc(_) => "an Arc constructor",
            Self::Circle(_) => "a Circle constructor",
            Self::ControlPointSpline(_) => "a Control Point Spline constructor",
        }
    }
}

/// The direction that an arc sweeps from its start point to its end point.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "lowercase")]
pub enum ArcDirection {
    #[default]
    Ccw,
    Cw,
}

impl ArcDirection {
    pub fn is_ccw(&self) -> bool {
        matches!(self, ArcDirection::Ccw)
    }

    pub fn is_clockwise(self) -> bool {
        matches!(self, ArcDirection::Cw)
    }

    /// Reorder an arc's declared start and end so that sweeping
    /// counterclockwise from the first to the second traverses the arc. Useful
    /// for consumers like the solver that only understand counterclockwise
    /// arcs.
    pub fn ccw_order<T>(self, start: T, end: T) -> (T, T) {
        match self {
            ArcDirection::Ccw => (start, end),
            ArcDirection::Cw => (end, start),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiControlPointSpline")]
pub struct ControlPointSpline {
    pub controls: Vec<ObjectId>,
    pub degree: u32,
    pub ctor: SegmentCtor,
    pub ctor_applicable: bool,
    pub construction: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiPoint2d")]
pub struct Point2d<U: std::fmt::Debug + Clone + ts_rs::TS> {
    pub x: U,
    pub y: U,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct PointCtor {
    pub position: Point2d<Expr>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct LineCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub construction: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub enum Freedom {
    Free,
    Fixed,
    Conflict,
}

impl Freedom {
    /// Merges two Freedom values. For example, a point has a solver variable
    /// for each dimension, x and y. If one dimension is `Free` and the other is
    /// `Fixed`, the point overall is `Free` since it isn't fully constrained.
    /// `Conflict` infects the most, followed by `Free`. An object must be fully
    /// `Fixed` to be `Fixed` overall.
    pub fn merge(self, other: Self) -> Self {
        match (self, other) {
            (Self::Conflict, _) | (_, Self::Conflict) => Self::Conflict,
            (Self::Free, _) | (_, Self::Free) => Self::Free,
            (Self::Fixed, Self::Fixed) => Self::Fixed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct ArcCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
    pub center: Point2d<Expr>,
    /// The direction that the arc sweeps from start to end. `None` means it
    /// wasn't written in the source, which defaults to counterclockwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub direction: Option<ArcDirection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub construction: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct CircleCtor {
    pub start: Point2d<Expr>,
    pub center: Point2d<Expr>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub construction: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct ControlPointSplineCtor {
    pub points: Vec<Point2d<Expr>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub construction: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiConstraint")]
#[serde(tag = "type")]
// When adding a new constraint type, check trim compatibility. New constraints
// can break trim in unexpected ways, especially when endpoints are edited,
// segments are split, or constraints are migrated. Try the trim tool on sketches
// using the new constraint, and talk to Kurt, Max, or a mechanical engineer if
// the intended trim behavior is unclear.
pub enum Constraint {
    Coincident(Coincident),
    Distance(Distance),
    Angle(Angle),
    Diameter(Diameter),
    EqualRadius(EqualRadius),
    Fixed(Fixed),
    HorizontalDistance(Distance),
    VerticalDistance(Distance),
    Horizontal(Horizontal),
    LinesEqualLength(LinesEqualLength),
    Midpoint(Midpoint),
    Parallel(Parallel),
    Perpendicular(Perpendicular),
    Radius(Radius),
    Symmetric(Symmetric),
    Tangent(Tangent),
    Vertical(Vertical),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Diameter {
    pub arc: ObjectId,
    pub diameter: Number,
    #[serde(rename = "labelPosition")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(rename = "labelPosition")]
    #[ts(optional)]
    pub label_position: Option<Point2d<Number>>,
    #[serde(default)]
    pub source: ConstraintSource,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", optional_fields)]
pub struct EqualRadius {
    pub input: Vec<ObjectId>,
}

/// Multiple fixed constraints, allowing callers to add fixed constraints on
/// multiple points at once.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Fixed {
    pub points: Vec<FixedPoint>,
}

/// A fixed constraint on a single point.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct FixedPoint {
    pub point: ObjectId,
    pub position: Point2d<Number>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(untagged)]
pub enum Horizontal {
    Line { line: ObjectId },
    Points { points: Vec<ConstraintSegment> },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct LinesEqualLength {
    pub lines: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Midpoint {
    pub point: ConstraintSegment,
    #[serde(alias = "line")]
    pub segment: ObjectId,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(untagged)]
pub enum Vertical {
    Line { line: ObjectId },
    Points { points: Vec<ConstraintSegment> },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", optional_fields)]
pub struct Parallel {
    pub lines: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", optional_fields)]
pub struct Perpendicular {
    pub lines: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", optional_fields)]
pub struct Symmetric {
    pub input: Vec<ObjectId>,
    pub axis: ObjectId,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", optional_fields)]
pub struct Tangent {
    pub input: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Coincident {
    pub segments: Vec<ConstraintSegment>,
}
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(untagged)]
pub enum ConstraintSegment {
    Segment(ObjectId),
    Origin(OriginLiteral),
}

impl ConstraintSegment {
    pub const ORIGIN: Self = Self::Origin(OriginLiteral::Origin);
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OriginLiteral {
    Origin,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Distance {
    pub segments: Vec<ConstraintSegment>,
    pub distance: Number,
    #[serde(rename = "labelPosition")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(rename = "labelPosition")]
    #[ts(optional)]
    pub label_position: Option<Point2d<Number>>,
    pub source: ConstraintSource,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Angle {
    pub lines: Vec<ObjectId>,
    pub angle: Number,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sector: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub inverse: Option<bool>,
    #[serde(rename = "labelPosition")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(rename = "labelPosition")]
    #[ts(optional)]
    pub label_position: Option<Point2d<Number>>,
    pub source: ConstraintSource,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Radius {
    pub arc: ObjectId,
    pub radius: Number,
    #[serde(rename = "labelPosition")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(rename = "labelPosition")]
    #[ts(optional)]
    pub label_position: Option<Point2d<Number>>,
    #[serde(default)]
    pub source: ConstraintSource,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct ConstraintSource {
    pub expr: String,
    pub is_literal: bool,
}
