#![allow(async_fn_in_trait)]

use kcl_api::Arc;
use kcl_api::Circle;
use kcl_api::Coincident;
use kcl_api::Constraint;
use kcl_api::ConstraintSegment;
use kcl_api::ControlPointSpline;
use kcl_api::Distance;
use kcl_api::Freedom;
use kcl_api::Line;
use kcl_api::Number;
use kcl_api::ObjectId;
use kcl_api::Point;
use kcl_api::Point2d;
use kcl_api::Segment;
use kcl_api::SegmentCtor;
use kcl_api::SketchCtor;
use serde::Deserialize;
use serde::Serialize;

use crate::ExecutorContext;
use crate::KclErrorWithOutputs;
use crate::frontend::api::FileId;
use crate::frontend::api::ProjectId;
use crate::frontend::api::SceneGraphDelta;
use crate::frontend::api::SourceDelta;
use crate::frontend::api::Version;

pub type ExecResult<T> = std::result::Result<T, KclErrorWithOutputs>;

/// Information about a newly created segment for batch operations
#[derive(Debug, Clone)]
pub struct NewSegmentInfo {
    pub segment_id: ObjectId,
    pub start_point_id: ObjectId,
    pub end_point_id: ObjectId,
    pub center_point_id: Option<ObjectId>,
}

pub trait SketchApi {
    /// Execute the sketch in mock mode, without changing anything. This is
    /// useful after editing segments, and the user releases the mouse button.
    async fn execute_mock(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    async fn new_sketch(
        &mut self,
        ctx: &ExecutorContext,
        project: ProjectId,
        file: FileId,
        version: Version,
        args: SketchCtor,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta, ObjectId)>;

    // Enters sketch mode
    async fn edit_sketch(
        &mut self,
        ctx: &ExecutorContext,
        project: ProjectId,
        file: FileId,
        version: Version,
        sketch: ObjectId,
    ) -> ExecResult<SceneGraphDelta>;

    async fn exit_sketch(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
    ) -> ExecResult<SceneGraphDelta>;

    async fn delete_sketch(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    async fn add_segment(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        segment: SegmentCtor,
        label: Option<String>,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    async fn edit_segments(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        segments: Vec<ExistingSegmentCtor>,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    async fn delete_objects(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint_ids: Vec<ObjectId>,
        segment_ids: Vec<ObjectId>,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    async fn add_constraint(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint: Constraint,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    async fn chain_segment(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        previous_segment_end_point_id: ObjectId,
        segment: SegmentCtor,
        label: Option<String>,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    async fn edit_constraint_value(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint_id: ObjectId,
        value_expression: String,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    async fn edit_distance_constraint_label_position(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        constraint_id: ObjectId,
        label_position: Point2d<Number>,
        anchor_segment_ids: Vec<ObjectId>,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    /// Batch operations for split segment: edit segments, add constraints, delete objects.
    /// All operations are applied to a single AST and execute_after_edit is called once at the end.
    /// new_segment_info contains the IDs from the segment(s) added in a previous step.
    #[allow(clippy::too_many_arguments)]
    async fn batch_split_segment_operations(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        edit_segments: Vec<ExistingSegmentCtor>,
        add_constraints: Vec<Constraint>,
        delete_constraint_ids: Vec<ObjectId>,
        new_segment_info: NewSegmentInfo,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;

    /// Batch operations for tail-cut trim: edit a segment, add coincident constraints,
    /// delete constraints, and execute once.
    #[allow(clippy::too_many_arguments)]
    async fn batch_tail_cut_operations(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        edit_segments: Vec<ExistingSegmentCtor>,
        add_constraints: Vec<Constraint>,
        delete_constraint_ids: Vec<ObjectId>,
        additional_edited_segment_ids: Vec<ObjectId>,
    ) -> ExecResult<(SourceDelta, SceneGraphDelta)>;
}

/// Runtime helpers for [`Point`].
pub trait PointExt {
    /// The freedom of this point.
    fn freedom(&self) -> Freedom;
}

impl PointExt for Point {
    fn freedom(&self) -> Freedom {
        self.freedom
    }
}

/// Runtime helpers for [`Segment`].
pub trait SegmentExt {
    /// What kind of geometry is this (point, line, arc, etc)
    /// Suitable for use in user-facing messages.
    fn human_friendly_kind_with_article(&self) -> &'static str;
    /// Compute the overall freedom of this segment. For geometry types (Line,
    /// Arc, Circle) this looks up and merges the freedom of their constituent
    /// points. For points, returns the point's own freedom directly.
    /// Returns `None` if a required point lookup failed.
    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom>;
}

impl SegmentExt for Segment {
    fn human_friendly_kind_with_article(&self) -> &'static str {
        match self {
            Self::Point(_) => "a Point",
            Self::Line(_) => "a Line",
            Self::Arc(_) => "an Arc",
            Self::Circle(_) => "a Circle",
            Self::ControlPointSpline(_) => "a Control Point Spline",
        }
    }

    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom> {
        match self {
            Self::Point(p) => Some(p.freedom()),
            Self::Line(l) => l.freedom(&lookup),
            Self::Arc(a) => a.freedom(&lookup),
            Self::Circle(c) => c.freedom(&lookup),
            Self::ControlPointSpline(s) => s.freedom(&lookup),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct ExistingSegmentCtor {
    pub id: ObjectId,
    pub ctor: SegmentCtor,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct ConstraintLabelPositionEdit {
    pub constraint_id: ObjectId,
    pub label_position: Point2d<Number>,
}

/// Runtime helpers for [`Line`].
pub trait LineExt {
    /// Compute the overall freedom of this line by merging the freedom of its
    /// start and end points. Returns `None` if a point lookup failed.
    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom>;
}

impl LineExt for Line {
    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom> {
        let start = lookup(self.start)?;
        let end = lookup(self.end)?;
        Some(start.merge(end))
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiStartOrEnd")]
#[serde(tag = "type")]
pub enum StartOrEnd<T> {
    Start(T),
    End(T),
}

/// Runtime helpers for [`Arc`].
pub trait ArcExt {
    /// Compute the overall freedom of this arc by merging the freedom of its
    /// start, end, and center points. Returns `None` if a point lookup failed.
    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom>;
}

impl ArcExt for Arc {
    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom> {
        let start = lookup(self.start)?;
        let end = lookup(self.end)?;
        let center = lookup(self.center)?;
        Some(start.merge(end).merge(center))
    }
}

/// Runtime helpers for [`Circle`].
pub trait CircleExt {
    /// Compute the overall freedom of this circle by merging the freedom of its
    /// start and center points. Returns `None` if a point lookup failed.
    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom>;
}

impl CircleExt for Circle {
    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom> {
        let start = lookup(self.start)?;
        let center = lookup(self.center)?;
        Some(start.merge(center))
    }
}

/// Runtime helpers for [`ControlPointSpline`].
pub trait ControlPointSplineExt {
    /// Compute the overall freedom of this spline by merging the freedom of its
    /// control points. Returns `None` if any required point lookup failed.
    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom>;
}

impl ControlPointSplineExt for ControlPointSpline {
    fn freedom(&self, lookup: impl Fn(ObjectId) -> Option<Freedom>) -> Option<Freedom> {
        let mut controls = self.controls.iter();
        let first = lookup(*controls.next()?)?;
        let merged = controls.try_fold(first, |acc, id| lookup(*id).map(|freedom| acc.merge(freedom)))?;
        Some(merged)
    }
}

/// Runtime helpers for [`Coincident`].
pub trait CoincidentExt {
    fn get_segments(&self) -> Vec<ObjectId>;
    fn segment_ids(&self) -> impl Iterator<Item = ObjectId> + '_;
    fn contains_segment(&self, segment_id: ObjectId) -> bool;
}

impl CoincidentExt for Coincident {
    fn get_segments(&self) -> Vec<ObjectId> {
        self.segments
            .iter()
            .filter_map(|segment| match segment {
                ConstraintSegment::Segment(id) => Some(*id),
                ConstraintSegment::Origin(_) => None,
            })
            .collect()
    }

    fn segment_ids(&self) -> impl Iterator<Item = ObjectId> + '_ {
        self.segments.iter().filter_map(|segment| match segment {
            ConstraintSegment::Segment(id) => Some(*id),
            ConstraintSegment::Origin(_) => None,
        })
    }

    fn contains_segment(&self, segment_id: ObjectId) -> bool {
        self.segment_ids().any(|id| id == segment_id)
    }
}

/// Runtime helpers for [`Distance`].
pub trait DistanceExt {
    fn segment_ids(&self) -> impl Iterator<Item = ObjectId> + '_;
    fn contains_segment(&self, segment_id: ObjectId) -> bool;
}

impl DistanceExt for Distance {
    fn segment_ids(&self) -> impl Iterator<Item = ObjectId> + '_ {
        self.segments.iter().filter_map(|segment| match segment {
            ConstraintSegment::Segment(id) => Some(*id),
            ConstraintSegment::Origin(_) => None,
        })
    }

    fn contains_segment(&self, segment_id: ObjectId) -> bool {
        self.segment_ids().any(|id| id == segment_id)
    }
}
