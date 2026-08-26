use indexmap::IndexMap;
use kcl_error::SourceRange;
use parse_display::Display;
use parse_display::FromStr;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use serde::ser::SerializeSeq;
use uuid::Uuid;

use crate::ArtifactId;
use crate::NodePath;
use crate::ObjectId;
use crate::UnitLength;

pub type DummyPathToNode = Vec<()>;

fn serialize_dummy_path_to_node<S>(_path_to_node: &DummyPathToNode, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    let seq = serializer.serialize_seq(Some(0))?;
    seq.end()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct CodeRef {
    pub range: SourceRange,
    pub node_path: NodePath,
    // TODO: We should implement this in Rust.
    #[serde(default, serialize_with = "serialize_dummy_path_to_node")]
    #[ts(type = "Array<[string | number, string]>")]
    pub path_to_node: DummyPathToNode,
}

impl CodeRef {
    pub fn placeholder(range: SourceRange) -> Self {
        Self {
            range,
            node_path: Default::default(),
            path_to_node: Vec::new(),
        }
    }
}

#[derive(Debug, Hash, Eq, Copy, Clone, Deserialize, Serialize, JsonSchema, PartialEq, ts_rs::TS, Display, FromStr)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PlaneName {
    /// The XY plane.
    #[display("XY")]
    Xy,
    /// The opposite side of the XY plane.
    #[display("-XY")]
    NegXy,
    /// The XZ plane.
    #[display("XZ")]
    Xz,
    /// The opposite side of the XZ plane.
    #[display("-XZ")]
    NegXz,
    /// The YZ plane.
    #[display("YZ")]
    Yz,
    /// The opposite side of the YZ plane.
    #[display("-YZ")]
    NegYz,
}

/// API-owned point data used by artifact payloads so the wire model does not
/// depend on kcl-lib's execution geometry types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Default, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
pub struct ArtifactPoint3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub units: Option<UnitLength>,
}

/// API-owned plane data used by artifacts. It mirrors kcl-lib's evaluated
/// plane JSON shape while keeping kcl-api independent of execution internals.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPlaneInfo {
    pub origin: ArtifactPoint3d,
    pub x_axis: ArtifactPoint3d,
    pub y_axis: ArtifactPoint3d,
    pub z_axis: ArtifactPoint3d,
}

/// API-owned sweep method equivalent to the engine extrusion method, avoiding
/// a kcl-api dependency on kittycad-modeling-cmds.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "snake_case")]
pub enum ArtifactSweepMethod {
    New,
    Merge,
}

/// API-owned camera orientation used by named-view artifacts, equivalent to
/// the KCL enum `std::view::Orientation`. Keeping it here means the wire model
/// does not depend on kcl-lib's execution types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum ArtifactOrientation {
    Front,
    Back,
    Left,
    Right,
    Top,
    Bottom,
    Isometric,
}

/// API-owned camera projection used by named-view artifacts, equivalent to the
/// KCL enum `std::view::Projection`. See [`ArtifactOrientation`].
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum ArtifactProjection {
    Orthographic,
    Perspective,
}

/// API-owned visibility baseline used by named-view artifacts, equivalent to
/// the KCL enum `std::view::Visibility`. `Show` means every object is visible
/// except those the view's hide list names; `Hide` means the reverse.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum ArtifactVisibility {
    Show,
    Hide,
}

/// Where a named view's camera looks from: one variant per KCL constructor
/// function, so a stored view can never carry both a curated orientation and a
/// custom direction.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ArtifactCameraLook {
    /// A curated orientation, from `view::oriented`.
    Oriented { orientation: ArtifactOrientation },
    /// A custom look direction, from `view::directed`. Both vectors are
    /// directions rather than positions, so their `units` are absent, and both
    /// are already normalized.
    Directed {
        direction: ArtifactPoint3d,
        up: ArtifactPoint3d,
    },
}

/// API-owned camera intent used by named-view artifacts. It mirrors kcl-lib's
/// `CameraView` JSON shape while keeping kcl-api independent of execution
/// internals, as [`ArtifactPlaneInfo`] does for planes.
///
/// The values are intent, not a snapshot of engine camera state: an absent
/// field is resolved by whichever consumer activates the view. Every length is
/// in millimeters, converted when the view was constructed.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct ArtifactCameraView {
    pub look: ArtifactCameraLook,
    /// The point the camera looks at, in millimeters. Absent means: center on
    /// the bounds of the model at activation.
    pub target: Option<ArtifactPoint3d>,
    /// The distance from the camera to the target, in millimeters. Absent
    /// means: fit the model at activation.
    pub distance: Option<f64>,
    pub projection: ArtifactProjection,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct CompositeSolid {
    pub id: ArtifactId,
    /// Whether this artifact has been used in a subsequent operation
    pub consumed: bool,
    pub sub_type: CompositeSolidSubType,
    /// Index of this output in the expression result, for operations that
    /// return multiple selectable bodies from one KCL variable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_index: Option<usize>,
    /// Constituent solids of the composite solid.
    pub solid_ids: Vec<ArtifactId>,
    /// Tool solids used for asymmetric operations like subtract.
    pub tool_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
    /// This is the ID of the composite solid that this is part of, if any, as a
    /// composite solid can be used as input for another composite solid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composite_solid_id: Option<ArtifactId>,
    /// Pattern operations that use this composite solid as their source.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pattern_ids: Vec<ArtifactId>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum CompositeSolidSubType {
    Intersect,
    Subtract,
    Split,
    Union,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Plane {
    pub id: ArtifactId,
    pub path_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Path {
    pub id: ArtifactId,
    pub sub_type: PathSubType,
    pub plane_id: ArtifactId,
    pub seg_ids: Vec<ArtifactId>,
    /// Whether this artifact has been used in a subsequent operation
    pub consumed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// The sweep, if any, that this Path serves as the base path for.
    /// corresponds to `path_id` on the Sweep.
    pub sweep_id: Option<ArtifactId>,
    /// The sweep, if any, that this Path serves as the trajectory for.
    pub trajectory_sweep_id: Option<ArtifactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solid2d_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
    /// This is the ID of the composite solid that this is part of, if any, as
    /// this can be used as input for another composite solid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composite_solid_id: Option<ArtifactId>,
    /// For sketch paths, the ID of the sketch block this path was created
    /// from. `None` for region paths and paths created in other ways.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sketch_block_id: Option<ArtifactId>,
    /// For region paths, the ID of the sketch path this region was created
    /// from. `None` for sketch paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_path_id: Option<ArtifactId>,
    /// The hole, if any, from a subtract2d() call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inner_path_id: Option<ArtifactId>,
    /// The `Path` that this is a hole of, if any. The inverse link of
    /// `inner_path_id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outer_path_id: Option<ArtifactId>,
    /// Pattern operations that use this path as their source.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pattern_ids: Vec<ArtifactId>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum PathSubType {
    Sketch,
    Region,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: ArtifactId,
    pub path_id: ArtifactId,
    /// The original segment this segment was cloned from, if any. For clones
    /// of clones, this continues to point to the originating segment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_segment_id: Option<ArtifactId>,
    /// If this artifact is a segment in a region, the segment in the original
    /// sketch that this was derived from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_seg_id: Option<ArtifactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<ArtifactId>,
    pub edge_ids: Vec<ArtifactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_cut_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
    pub common_surface_ids: Vec<ArtifactId>,
}

/// A sweep is a more generic term for extrude, revolve, loft, sweep, and blend.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Sweep {
    pub id: ArtifactId,
    pub sub_type: SweepSubType,
    pub path_id: ArtifactId,
    pub surface_ids: Vec<ArtifactId>,
    pub edge_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
    /// The original sweep this body was cloned from, if any. For clones of
    /// clones, this continues to point to the originating sweep.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sweep_id: Option<ArtifactId>,
    /// ID of trajectory path for sweep, if any
    /// Only applicable to SweepSubType::Sweep and SweepSubType::Blend, which
    /// can use a second path-like input
    pub trajectory_id: Option<ArtifactId>,
    pub method: ArtifactSweepMethod,
    /// Whether this artifact has been used in a subsequent operation
    pub consumed: bool,
    /// Pattern operations that use this sweep as their source.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pattern_ids: Vec<ArtifactId>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum SweepSubType {
    Extrusion,
    ExtrusionTwist,
    Revolve,
    RevolveAboutEdge,
    Loft,
    Blend,
    Sweep,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Solid2d {
    pub id: ArtifactId,
    pub path_id: ArtifactId,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrimitiveFace {
    pub id: ArtifactId,
    pub solid_id: ArtifactId,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrimitiveEdge {
    pub id: ArtifactId,
    pub solid_id: ArtifactId,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct PlaneOfFace {
    pub id: ArtifactId,
    pub face_id: ArtifactId,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct StartSketchOnFace {
    pub id: ArtifactId,
    pub face_id: ArtifactId,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct StartSketchOnPlane {
    pub id: ArtifactId,
    pub plane_id: ArtifactId,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchBlock {
    pub id: ArtifactId,
    /// The semantic standard plane name when the sketch block is on a standard plane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub standard_plane: Option<PlaneName>,
    /// The concrete plane artifact ID backing the sketch block, when one is available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plane_id: Option<ArtifactId>,
    /// The evaluated plane data backing the sketch block, when the sketch is on a plane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plane_info: Option<ArtifactPlaneInfo>,
    /// The path artifact ID created from the sketch block, if there is one.
    /// There are edge cases when a path isn't created, like when there are no
    /// segments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
    /// The sketch ID (ObjectId) for the sketch scene object.
    pub sketch_id: ObjectId,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum SketchBlockConstraintType {
    Angle,
    Coincident,
    Distance,
    Diameter,
    EqualRadius,
    Fixed,
    HorizontalDistance,
    VerticalDistance,
    Horizontal,
    LinesEqualLength,
    Midpoint,
    Parallel,
    Perpendicular,
    Radius,
    Symmetric,
    Tangent,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchBlockConstraint {
    pub id: ArtifactId,
    /// The sketch ID (ObjectId) that owns this constraint.
    pub sketch_id: ObjectId,
    /// The constraint ID (ObjectId) for the constraint scene object.
    pub constraint_id: ObjectId,
    pub constraint_type: SketchBlockConstraintType,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Wall {
    pub id: ArtifactId,
    pub seg_id: ArtifactId,
    pub edge_cut_edge_ids: Vec<ArtifactId>,
    pub sweep_id: ArtifactId,
    pub path_ids: Vec<ArtifactId>,
    /// This is for the sketch-on-face plane, not for the wall itself.  Traverse
    /// to the extrude and/or segment to get the wall's code_ref.
    pub face_code_ref: CodeRef,
    /// The command ID that got the data for this wall. Used for stable sorting.
    pub cmd_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Cap {
    pub id: ArtifactId,
    pub sub_type: CapSubType,
    pub edge_cut_edge_ids: Vec<ArtifactId>,
    pub sweep_id: ArtifactId,
    pub path_ids: Vec<ArtifactId>,
    /// This is for the sketch-on-face plane, not for the cap itself.  Traverse
    /// to the extrude and/or segment to get the cap's code_ref.
    pub face_code_ref: CodeRef,
    /// The command ID that got the data for this cap. Used for stable sorting.
    pub cmd_id: Uuid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum CapSubType {
    Start,
    End,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct SweepEdge {
    pub id: ArtifactId,
    pub sub_type: SweepEdgeSubType,
    pub seg_id: ArtifactId,
    pub cmd_id: Uuid,
    // This is only used for sorting, not for the actual artifact.
    #[serde(skip)]
    pub index: usize,
    pub sweep_id: ArtifactId,
    pub common_surface_ids: Vec<ArtifactId>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum SweepEdgeSubType {
    Opposite,
    Adjacent,
    PreviousAdjacent,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct EdgeCut {
    pub id: ArtifactId,
    pub sub_type: EdgeCutSubType,
    pub consumed_edge_id: ArtifactId,
    pub edge_ids: Vec<ArtifactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum EdgeCutSubType {
    Fillet,
    Chamfer,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct EdgeCutEdge {
    pub id: ArtifactId,
    pub edge_cut_id: ArtifactId,
    pub surface_id: ArtifactId,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Helix {
    pub id: ArtifactId,
    /// The axis of the helix.  Currently this is always an edge ID, but we may
    /// add axes to the graph.
    pub axis_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
    /// The sweep, if any, that this Helix serves as the trajectory for.
    pub trajectory_sweep_id: Option<ArtifactId>,
    /// Whether this artifact has been used in a subsequent operation
    pub consumed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct ImportedGeometryArtifact {
    pub id: ArtifactId,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct GdtAnnotationArtifact {
    pub id: ArtifactId,
    pub code_ref: CodeRef,
}

/// A named view declared in KCL by `view::named`: a display name, camera intent
/// and the objects the view shows or hides.
///
/// The view is data for a consumer to activate later, so this artifact holds no
/// engine geometry and its creation sends no engine command. The objects are
/// named by ARTIFACT id, so a consumer resolves each one through the artifact
/// graph; an extruded solid's engine id differs from its artifact id, and the
/// translation belongs to whoever applies the view.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct NamedViewArtifact {
    pub id: ArtifactId,
    /// The display name the author gave the view. Required, and unique among
    /// the views declared by the same module.
    pub name: String,
    pub camera: ArtifactCameraView,
    /// Whether objects start visible or hidden, which decides which of the two
    /// lists below can act.
    pub baseline: ArtifactVisibility,
    /// Artifacts the view shows. Meaningful under a `Hide` baseline, where they
    /// are the only visible objects.
    pub show_ids: Vec<ArtifactId>,
    /// Artifacts the view hides. Meaningful under a `Show` baseline, where they
    /// are the only hidden objects.
    pub hide_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    pub id: ArtifactId,
    pub sub_type: PatternSubType,
    /// Geometry artifact that was the source of the pattern operation.
    pub source_id: ArtifactId,
    /// IDs of copied top-level objects created by the pattern operation.
    pub copy_ids: Vec<ArtifactId>,
    /// IDs of copied faces created by the pattern operation.
    pub copy_face_ids: Vec<ArtifactId>,
    /// IDs of copied edges created by the pattern operation.
    pub copy_edge_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum PatternSubType {
    Circular,
    Linear,
    Transform,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Artifact {
    CompositeSolid(CompositeSolid),
    Plane(Plane),
    Path(Path),
    Segment(Segment),
    Solid2d(Solid2d),
    PrimitiveFace(PrimitiveFace),
    PrimitiveEdge(PrimitiveEdge),
    PlaneOfFace(PlaneOfFace),
    StartSketchOnFace(StartSketchOnFace),
    StartSketchOnPlane(StartSketchOnPlane),
    SketchBlock(SketchBlock),
    SketchBlockConstraint(SketchBlockConstraint),
    Sweep(Sweep),
    Wall(Wall),
    Cap(Cap),
    SweepEdge(SweepEdge),
    EdgeCut(EdgeCut),
    EdgeCutEdge(EdgeCutEdge),
    Helix(Helix),
    ImportedGeometry(ImportedGeometryArtifact),
    GdtAnnotation(GdtAnnotationArtifact),
    NamedView(NamedViewArtifact),
    Pattern(Pattern),
}

impl Artifact {
    pub fn id(&self) -> ArtifactId {
        match self {
            Self::CompositeSolid(a) => a.id,
            Self::Plane(a) => a.id,
            Self::Path(a) => a.id,
            Self::Segment(a) => a.id,
            Self::Solid2d(a) => a.id,
            Self::PrimitiveFace(a) => a.id,
            Self::PrimitiveEdge(a) => a.id,
            Self::PlaneOfFace(a) => a.id,
            Self::StartSketchOnFace(a) => a.id,
            Self::StartSketchOnPlane(a) => a.id,
            Self::SketchBlock(a) => a.id,
            Self::SketchBlockConstraint(a) => a.id,
            Self::Sweep(a) => a.id,
            Self::Wall(a) => a.id,
            Self::Cap(a) => a.id,
            Self::SweepEdge(a) => a.id,
            Self::EdgeCut(a) => a.id,
            Self::EdgeCutEdge(a) => a.id,
            Self::Helix(a) => a.id,
            Self::ImportedGeometry(a) => a.id,
            Self::GdtAnnotation(a) => a.id,
            Self::NamedView(a) => a.id,
            Self::Pattern(a) => a.id,
        }
    }

    /// The [`CodeRef`] for the artifact itself. See also
    /// [`Self::face_code_ref`].
    pub fn code_ref(&self) -> Option<&CodeRef> {
        match self {
            Self::CompositeSolid(a) => Some(&a.code_ref),
            Self::Plane(a) => Some(&a.code_ref),
            Self::Path(a) => Some(&a.code_ref),
            Self::Segment(a) => Some(&a.code_ref),
            Self::Solid2d(_) => None,
            Self::PrimitiveFace(a) => Some(&a.code_ref),
            Self::PrimitiveEdge(a) => Some(&a.code_ref),
            Self::PlaneOfFace(a) => Some(&a.code_ref),
            Self::StartSketchOnFace(a) => Some(&a.code_ref),
            Self::StartSketchOnPlane(a) => Some(&a.code_ref),
            Self::SketchBlock(a) => Some(&a.code_ref),
            Self::SketchBlockConstraint(a) => Some(&a.code_ref),
            Self::Sweep(a) => Some(&a.code_ref),
            Self::Wall(_) | Self::Cap(_) | Self::SweepEdge(_) => None,
            Self::EdgeCut(a) => Some(&a.code_ref),
            Self::EdgeCutEdge(_) => None,
            Self::Helix(a) => Some(&a.code_ref),
            Self::ImportedGeometry(a) => Some(&a.code_ref),
            Self::GdtAnnotation(a) => Some(&a.code_ref),
            Self::NamedView(a) => Some(&a.code_ref),
            Self::Pattern(a) => Some(&a.code_ref),
        }
    }

    /// The [`CodeRef`] referring to the face artifact that it's on, not the
    /// artifact itself.
    pub fn face_code_ref(&self) -> Option<&CodeRef> {
        match self {
            Self::PrimitiveFace(a) => Some(&a.code_ref),
            Self::Wall(a) => Some(&a.face_code_ref),
            Self::Cap(a) => Some(&a.face_code_ref),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct ArtifactGraph {
    map: IndexMap<ArtifactId, Artifact>,
    item_count: usize,
}

impl ArtifactGraph {
    pub fn from_parts(map: IndexMap<ArtifactId, Artifact>, item_count: usize) -> Self {
        Self { map, item_count }
    }

    pub fn into_parts(self) -> (IndexMap<ArtifactId, Artifact>, usize) {
        (self.map, self.item_count)
    }

    pub fn item_count(&self) -> usize {
        self.item_count
    }

    pub fn get(&self, id: &ArtifactId) -> Option<&Artifact> {
        self.map.get(id)
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&ArtifactId, &Artifact)> {
        self.map.iter()
    }

    pub fn values(&self) -> impl Iterator<Item = &Artifact> {
        self.map.values()
    }

    pub fn clear(&mut self) {
        self.map.clear();
        self.item_count = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_artifact_graph_json_round_trip() {
        let graph = ArtifactGraph::default();
        let json = serde_json::to_string(&graph).unwrap();

        assert_eq!(json, r#"{"map":{},"itemCount":0}"#);
        assert_eq!(serde_json::from_str::<ArtifactGraph>(&json).unwrap(), graph);
    }

    #[test]
    fn artifact_sweep_method_uses_engine_json_shape() {
        assert_eq!(serde_json::to_string(&ArtifactSweepMethod::New).unwrap(), r#""new""#);
        assert_eq!(
            serde_json::to_string(&ArtifactSweepMethod::Merge).unwrap(),
            r#""merge""#
        );
    }
}
