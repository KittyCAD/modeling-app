#![allow(async_fn_in_trait)]

use serde::{Deserialize, Serialize};

use crate::*;

pub trait SketchApi {
    async fn new_sketch(
        &self,
        project: ProjectId,
        file: FileId,
        version: Version,
        args: SketchArgs,
    ) -> Result<(SourceDelta, SceneGraphDelta, ObjectId)>;

    // Enters sketch mode
    async fn edit_sketch(
        &self,
        project: ProjectId,
        file: FileId,
        version: Version,
        sketch: ObjectId,
    ) -> Result<SceneGraphDelta>;

    async fn exit_sketch(&self, version: Version, sketch: ObjectId) -> Result<SceneGraph>;

    async fn add_segment(
        &self,
        version: Version,
        sketch: ObjectId,
        segment: SegmentArgs<Expr>,
    ) -> Result<SceneGraphDelta>;

    async fn edit_segment(
        &self,
        version: Version,
        sketch: ObjectId,
        segment_id: ObjectId,
        segment: SegmentArgs<Expr>,
    ) -> Result<SceneGraphDelta>;

    async fn delete_segment(&self, version: Version, sketch: ObjectId, segment_id: ObjectId)
    -> Result<SceneGraphDelta>;

    async fn add_constraint(
        &self,
        version: Version,
        sketch: ObjectId,
        constraint: ConstraintArgs,
    ) -> Result<SceneGraphDelta>;

    async fn edit_constraint(
        &self,
        version: Version,
        sketch: ObjectId,
        constraint_id: ObjectId,
        constraint: ConstraintArgs,
    ) -> Result<SceneGraphDelta>;

    async fn delete_constraint(
        &self,
        version: Version,
        sketch: ObjectId,
        constraint_id: ObjectId,
    ) -> Result<SceneGraphDelta>;
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum Segment {
    Line(Line),
    Arc(Arc),
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum SegmentArgs<U: std::fmt::Debug + Clone + ts_rs::TS> {
    Line(LineArgs<U>),
    Arc(ArcArgs<U>),
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiLine")]
pub struct Line {
    pub args: LineArgs<SolvedExpr>,
    pub start: Point2d<Number>,
    pub end: Point2d<Number>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiArc")]
pub struct Arc {
    pub args: ArcArgs<SolvedExpr>,
    // TODO
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum ConstraintArgs {
    Coincident(CoincidentArgs),
    Parallel(ParallelArgs),
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiPoint2d")]
pub struct Point2d<U: std::fmt::Debug + Clone + ts_rs::TS> {
    pub x: U,
    pub y: U,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub struct Sketch {
    pub args: SketchArgs,
    pub items: Vec<ObjectId>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub struct SketchArgs {
    pub on: Plane,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, optional_fields)]
pub struct LineArgs<U: std::fmt::Debug + Clone + ts_rs::TS> {
    pub start: Option<Point2d<U>>,
    pub end: Option<Point2d<U>>,
    pub angle: Option<U>,
    pub length: Option<U>,
    pub x_length: Option<U>,
    pub y_length: Option<U>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, optional_fields)]
pub struct ArcArgs<U: std::fmt::Debug + Clone + ts_rs::TS> {
    pub start: Option<Point2d<U>>,
    pub end: Option<Point2d<U>>,
    pub center: Option<Point2d<U>>,
    pub radius: Option<U>,
    pub start_angle: Option<U>,
    pub end_angle: Option<U>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct CoincidentArgs {
    points: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, optional_fields)]
pub struct ParallelArgs {
    lines: Vec<String>,
    distance: Option<Number>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct SolvedExpr {
    expr: Expr,
    value: Number,
}

impl Kind for SolvedExpr {}
