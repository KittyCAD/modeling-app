#![allow(async_fn_in_trait)]

use serde::{Deserialize, Serialize};

use crate::{
    ExecutorContext,
    frontend::api::{
        Expr, FileId, Number, ObjectId, ProjectId, Result, SceneGraph, SceneGraphDelta, SourceDelta, Version,
    },
};

pub trait SketchApi {
    /// Execute the sketch in mock mode, without changing anything. This is
    /// useful after editing segments, and the user releases the mouse button.
    async fn execute_mock(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn new_sketch(
        &mut self,
        ctx: &ExecutorContext,
        project: ProjectId,
        file: FileId,
        version: Version,
        args: SketchCtor,
    ) -> Result<(SourceDelta, SceneGraphDelta, ObjectId)>;

    // Enters sketch mode
    async fn edit_sketch(
        &mut self,
        ctx: &ExecutorContext,
        project: ProjectId,
        file: FileId,
        version: Version,
        sketch: ObjectId,
    ) -> Result<SceneGraphDelta>;

    async fn exit_sketch(&mut self, ctx: &ExecutorContext, version: Version, sketch: ObjectId) -> Result<SceneGraph>;

    async fn delete_sketch(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn add_segment(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        segment: SegmentCtor,
        label: Option<String>,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn edit_segments(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        segments: Vec<ExistingSegmentCtor>,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn delete_objects(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint_ids: Vec<ObjectId>,
        segment_ids: Vec<ObjectId>,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn add_constraint(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint: Constraint,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn chain_segment(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        previous_segment_end_point_id: ObjectId,
        segment: SegmentCtor,
        label: Option<String>,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn edit_constraint(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint_id: ObjectId,
        constraint: Constraint,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;
}

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
    /// Identifier representing the plane or face to sketch on. This could be a
    /// built-in plane like `XY`, a variable referencing a plane, or a variable
    /// referencing a face. But currently, it may not be an arbitrary
    /// expression. Notably, negative planes are not supported.
    pub on: String,
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
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiSegment")]
#[serde(tag = "type")]
pub enum Segment {
    Point(Point),
    Line(Line),
    Arc(Arc),
    Circle(Circle),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct ExistingSegmentCtor {
    pub id: ObjectId,
    pub ctor: SegmentCtor,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(tag = "type")]
pub enum SegmentCtor {
    Point(PointCtor),
    Line(LineCtor),
    Arc(ArcCtor),
    TangentArc(TangentArcCtor),
    Circle(CircleCtor),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct PointCtor {
    pub position: Point2d<Expr>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiPoint2d")]
pub struct Point2d<U: std::fmt::Debug + Clone + ts_rs::TS> {
    pub x: U,
    pub y: U,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiLine")]
pub struct Line {
    pub start: ObjectId,
    pub end: ObjectId,
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
#[ts(export, export_to = "FrontendApi.ts")]
pub struct LineCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub construction: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiStartOrEnd")]
#[serde(tag = "type")]
pub enum StartOrEnd<T> {
    Start(T),
    End(T),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiArc")]
pub struct Arc {
    pub start: ObjectId,
    pub end: ObjectId,
    pub center: ObjectId,
    // Invariant: Arc or TangentArc
    pub ctor: SegmentCtor,
    pub ctor_applicable: bool,
    pub construction: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct ArcCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
    pub center: Point2d<Expr>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub construction: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct TangentArcCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
    pub tangent: StartOrEnd<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiCircle")]
pub struct Circle {
    pub start: ObjectId,
    pub radius: Number,
    // Invariant: Circle or ThreePointCircle
    pub ctor: SegmentCtor,
    pub ctor_applicable: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct CircleCtor {
    pub center: Point2d<Expr>,
    pub radius: Expr,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiConstraint")]
#[serde(tag = "type")]
pub enum Constraint {
    Coincident(Coincident),
    Distance(Distance),
    Diameter(Diameter),
    HorizontalDistance(Distance),
    VerticalDistance(Distance),
    Horizontal(Horizontal),
    LinesEqualLength(LinesEqualLength),
    Parallel(Parallel),
    Perpendicular(Perpendicular),
    Radius(Radius),
    Vertical(Vertical),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Coincident {
    pub segments: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Distance {
    pub points: Vec<ObjectId>,
    pub distance: Number,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Radius {
    pub arc: ObjectId,
    pub radius: Number,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Diameter {
    pub arc: ObjectId,
    pub diameter: Number,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Horizontal {
    pub line: ObjectId,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct LinesEqualLength {
    pub lines: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Vertical {
    pub line: ObjectId,
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
