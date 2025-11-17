#![allow(async_fn_in_trait)]

use serde::{Deserialize, Serialize};

use crate::{
    ExecOutcome, ExecutorContext,
    frontend::api::{
        Expr, FileId, Number, ObjectId, Plane, ProjectId, Result, SceneGraph, SceneGraphDelta, SourceDelta, Version,
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
    ) -> Result<(SceneGraph, ExecOutcome)>;

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
    pub args: SketchArgs,
    pub segments: Vec<ObjectId>,
    pub constraints: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct SketchArgs {
    pub on: Plane,
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
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct LineCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
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
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct ArcCtor {
    pub start: Point2d<Expr>,
    pub end: Point2d<Expr>,
    pub center: Point2d<Expr>,
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
    Horizontal(Horizontal),
    LinesEqualLength(LinesEqualLength),
    Parallel(Parallel),
    Vertical(Vertical),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Coincident {
    pub points: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Distance {
    pub points: Vec<ObjectId>,
    pub distance: Number,
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

// Stub implementation of SketchApi for testing/development
pub struct SketchApiStub;

impl SketchApi for SketchApiStub {
    async fn execute_mock(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
    ) -> Result<(SceneGraph, ExecOutcome)> {
        todo!("execute_mock not implemented")
    }

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

    async fn exit_sketch(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
    ) -> Result<SceneGraph> {
        todo!("exit_sketch not implemented")
    }

    async fn add_segment(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _segment: SegmentCtor,
        _label: Option<String>,
    ) -> Result<(SourceDelta, SceneGraphDelta)> {
        // Return empty stub data
        Ok((
            SourceDelta { text: String::new() },
            SceneGraphDelta::new(
                SceneGraph::empty(ProjectId(0), FileId(0), Version(0)),
                Default::default(),
                false,
                crate::ExecOutcome {
                    variables: Default::default(),
                    #[cfg(feature = "artifact-graph")]
                    operations: Default::default(),
                    #[cfg(feature = "artifact-graph")]
                    artifact_graph: Default::default(),
                    #[cfg(feature = "artifact-graph")]
                    scene_objects: Default::default(),
                    #[cfg(feature = "artifact-graph")]
                    source_range_to_object: Default::default(),
                    #[cfg(feature = "artifact-graph")]
                    var_solutions: Default::default(),
                    errors: Default::default(),
                    filenames: Default::default(),
                    default_planes: Default::default(),
                },
            ),
        ))
    }

    async fn edit_segments(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _segments: Vec<ExistingSegmentCtor>,
    ) -> Result<(SourceDelta, SceneGraphDelta)> {
        todo!("edit_segments not implemented")
    }

    async fn delete_objects(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _constraint_ids: Vec<ObjectId>,
        _segment_ids: Vec<ObjectId>,
    ) -> Result<(SourceDelta, SceneGraphDelta)> {
        todo!("delete_segments not implemented")
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
}
