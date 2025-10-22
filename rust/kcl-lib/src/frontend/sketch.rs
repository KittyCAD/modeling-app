#![allow(async_fn_in_trait)]

use serde::{Deserialize, Serialize};

use crate::{
    ExecutorContext,
    frontend::api::{
        Expr, FileId, Number, ObjectId, Plane, ProjectId, Result, SceneGraph, SceneGraphDelta, SourceDelta, Version,
    },
};

pub trait SketchApi {
    async fn new_sketch(
        &mut self,
        ctx: &ExecutorContext,
        project: ProjectId,
        file: FileId,
        version: Version,
        args: SketchArgs,
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

    async fn add_segment(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        segment: SegmentCtor,
        label: Option<String>,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn edit_segment(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        segment_id: ObjectId,
        segment: SegmentCtor,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn delete_segment(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        segment_id: ObjectId,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn add_constraint(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint: Constraint,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn edit_constraint(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint_id: ObjectId,
        constraint: Constraint,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;

    async fn delete_constraint(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint_id: ObjectId,
    ) -> Result<(SourceDelta, SceneGraphDelta)>;
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiSketch")]
pub struct Sketch {
    pub args: SketchArgs,
    pub segments: Vec<ObjectId>,
    pub constraints: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct SketchArgs {
    pub on: Plane,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiPoint")]
pub struct Point {
    pub position: Point2d<Number>,
    pub ctor: Option<Point2d<Expr>>,
    pub owner: Option<ObjectId>,
    pub freedom: Freedom,
    pub constraints: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum Freedom {
    Free,
    Partial,
    Fixed,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiSegment")]
pub enum Segment {
    Point(Point),
    Line(Line),
    Arc(Arc),
    Circle(Circle),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum SegmentCtor {
    Point(Point2d<Expr>),
    Line(LineCtor),
    MidPointLine(MidPointLineCtor),
    Arc(ArcCtor),
    ThreePointArc(ThreePointArcCtor),
    TangentArc(TangentArcCtor),
    Circle(CircleCtor),
    ThreePointCircle(ThreePointCircleCtor),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiPoint2d")]
pub struct Point2d<U: std::fmt::Debug + Clone + ts_rs::TS> {
    pub x: U,
    pub y: U,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiLine")]
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
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct LineCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct MidPointLineCtor {
    pub midpoint: Point2d<Expr>,
    pub start_or_end: StartOrEnd<Point2d<Expr>>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiStartOrEnd")]
pub enum StartOrEnd<T> {
    Start(T),
    End(T),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiArc")]
pub struct Arc {
    pub start: ObjectId,
    pub end: ObjectId,
    pub center: ObjectId,
    // Invariant: Arc or ThreePointArc or TangentArc
    pub ctor: SegmentCtor,
    pub ctor_applicable: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ArcCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
    pub center: Point2d<Expr>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ThreePointArcCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
    pub interior: Point2d<Expr>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct TangentArcCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
    pub tangent: StartOrEnd<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiCircle")]
pub struct Circle {
    pub start: ObjectId,
    pub radius: Number,
    // Invariant: Circle or ThreePointCircle
    pub ctor: SegmentCtor,
    pub ctor_applicable: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct CircleCtor {
    pub center: Point2d<Expr>,
    pub radius: Expr,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ThreePointCircleCtor {
    pub p1: Point2d<Expr>,
    pub p2: Point2d<Expr>,
    pub p3: Point2d<Expr>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiConstraint")]
pub enum Constraint {
    Coincident(Coincident),
    Parallel(Parallel),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct Coincident {
    points: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, optional_fields)]
pub struct Parallel {
    lines: Vec<ObjectId>,
    distance: Option<Number>,
}
