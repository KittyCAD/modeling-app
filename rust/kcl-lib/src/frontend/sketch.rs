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
    pub ctor: Option<PointCtor>,
    pub owner: Option<ObjectId>,
    pub freedom: Freedom,
    pub constraints: Vec<ObjectId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum Freedom {
    Free,
    Partial,
    Fixed,
}

impl Freedom {
    pub fn merge(self, other: Self) -> Self {
        match self {
            Self::Free => match other {
                Self::Free => Self::Free,
                Self::Partial => Self::Partial,
                Self::Fixed => Self::Partial,
            },
            Self::Partial => Self::Partial,
            Self::Fixed => match other {
                Self::Free => Self::Partial,
                Self::Partial => Self::Partial,
                Self::Fixed => Self::Fixed,
            },
        }
    }
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
    Point(PointCtor),
    Line(LineCtor),
    MidPointLine(MidPointLineCtor),
    Arc(ArcCtor),
    ThreePointArc(ThreePointArcCtor),
    TangentArc(TangentArcCtor),
    Circle(CircleCtor),
    ThreePointCircle(ThreePointCircleCtor),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct PointCtor {
    pub position: Point2d<Expr>,
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

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct SketchExecOutcome {
    // The solved segments, including their locations so that they can be drawn.
    pub segments: Vec<SolveSegment>,
    // The interpreted constraints.
    pub constraints: Vec<SolveConstraint>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum SolveSegment {
    Point(SolvePointSegment),
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct SolvePointSegment {
    pub object_id: String,
    pub constrained_status: ConstrainedStatus,
    pub handles: Vec<PointHandle>,
    pub position: Point2d<Number>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum ConstrainedStatus {
    None,
    Partial,
    Full,
}

// Handles, i.e. UI elements that the user can interact with.
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct PointHandle {
    pub position: Point2d<Number>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum SolveConstraint {
    // e.g. Make these things coincident.
    Relation { kind: RelationKind, segment_ids: Vec<String> },
    // If segment2 is given, it's the perpendicular distance between them.
    Dimension {
        segment1_id: String,
        segment2_id: Option<String>,
        value: Number,
    },
    Angle {
        segment1_id: String,
        segment2_id: Option<String>,
        value: Number,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum RelationKind {
    Coincidence,
    Horizontal,
    Vertical,
    Tangent,
    Equal,
    Fixed,
}

// Stub implementation of SketchApi for testing/development
pub struct SketchApiStub;

impl SketchApi for SketchApiStub {
    async fn new_sketch(
        &mut self,
        _ctx: &ExecutorContext,
        _project: ProjectId,
        _file: FileId,
        _version: Version,
        _args: SketchArgs,
    ) -> Result<(SourceDelta, SceneGraphDelta, ObjectId)> {
        todo!("new_sketch not implemented")
    }

    async fn edit_sketch(
        &mut self,
        _ctx: &ExecutorContext,
        _project: ProjectId,
        _file: FileId,
        _version: Version,
        _sketch: ObjectId,
    ) -> Result<SceneGraphDelta> {
        todo!("edit_sketch not implemented")
    }

    async fn exit_sketch(&mut self, _ctx: &ExecutorContext, _version: Version, _sketch: ObjectId) -> Result<SceneGraph> {
        todo!("exit_sketch not implemented")
    }

    async fn add_segment(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _segment: SegmentCtor,
        _label: Option<String>,
    ) -> Result<(SourceDelta, SketchExecOutcome)> {
        // Return empty stub data
        Ok((
            SourceDelta {
                text: String::new(),
            },
            SketchExecOutcome {
                segments: Vec::new(),
                constraints: Vec::new(),
            },
        ))
    }

    async fn edit_segment(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _segment_id: ObjectId,
        _segment: SegmentCtor,
    ) -> Result<(SourceDelta, SceneGraphDelta)> {
        todo!("edit_segment not implemented")
    }

    async fn delete_segment(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _segment_id: ObjectId,
    ) -> Result<(SourceDelta, SceneGraphDelta)> {
        todo!("delete_segment not implemented")
    }

    async fn add_constraint(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _constraint: Constraint,
    ) -> Result<(SourceDelta, SceneGraphDelta)> {
        todo!("add_constraint not implemented")
    }

    async fn edit_constraint(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _constraint_id: ObjectId,
        _constraint: Constraint,
    ) -> Result<(SourceDelta, SceneGraphDelta)> {
        todo!("edit_constraint not implemented")
    }

    async fn delete_constraint(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _constraint_id: ObjectId,
    ) -> Result<(SourceDelta, SceneGraphDelta)> {
        todo!("delete_constraint not implemented")
    }
}
