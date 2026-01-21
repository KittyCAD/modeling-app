use std::fmt::Write;

use fnv::FnvHashMap;
use indexmap::IndexMap;
use crate::modules::ModuleId;
use crate::modules::ModulePath;
use kittycad_modeling_cmds::{
    self as kcmc, EnableSketchMode, FaceIsPlanar, ModelingCmd,
    ok_response::OkModelingCmdResponse,
    shared::ExtrusionFaceCapType,
    websocket::{BatchResponse, OkWebSocketResponseData, WebSocketResponse},
};
use serde::{Deserialize, Serialize, ser::SerializeSeq};
use uuid::Uuid;

use crate::{
    KclError, NodePath, SourceRange,
    errors::KclErrorDetails,
    execution::ArtifactId,
    front::ObjectId,
    parsing::ast::types::{Node, Program},
};

#[cfg(test)]
mod mermaid_tests;

macro_rules! internal_error {
    ($range:expr, $($rest:tt)*) => {{
        let message = format!($($rest)*);
        debug_assert!(false, "{}", &message);
        return Err(KclError::new_internal(KclErrorDetails::new(message, vec![$range])));
    }};
}

/// A command that may create or update artifacts on the TS side.  Because
/// engine commands are batched, we don't have the response yet when these are
/// created.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct ArtifactCommand {
    /// Identifier of the command that can be matched with its response.
    pub cmd_id: Uuid,
    /// The source range that's the boundary of calling the standard
    /// library, not necessarily the true source range of the command.
    pub range: SourceRange,
    /// The engine command.  Each artifact command is backed by an engine
    /// command.  In the future, we may need to send information to the TS side
    /// without an engine command, in which case, we would make this field
    /// optional.
    pub command: ModelingCmd,
}

pub type DummyPathToNode = Vec<()>;

fn serialize_dummy_path_to_node<S>(_path_to_node: &DummyPathToNode, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    // Always output an empty array, for now.
    let seq = serializer.serialize_seq(Some(0))?;
    seq.end()
}

fn deserialize_dummy_path_to_node<'de, D>(deserializer: D) -> Result<DummyPathToNode, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Always return an empty Vec<()>, ignoring any input
    // This is needed because Vec<()> can't be deserialized from JSON
    // (unit types don't have a JSON representation)
    use serde::de::Visitor;
    struct DummyPathToNodeVisitor;

    impl<'de> Visitor<'de> for DummyPathToNodeVisitor {
        type Value = DummyPathToNode;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an array (which will be ignored)")
        }

        fn visit_seq<A>(self, _seq: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::SeqAccess<'de>,
        {
            // Ignore the sequence and return empty Vec<()>
            Ok(Vec::new())
        }
    }

    deserializer.deserialize_seq(DummyPathToNodeVisitor)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct CodeRef {
    pub range: SourceRange,
    pub node_path: NodePath,
    // TODO: We should implement this in Rust.
    #[serde(
        default,
        serialize_with = "serialize_dummy_path_to_node",
        deserialize_with = "deserialize_dummy_path_to_node"
    )]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct CompositeSolid {
    pub id: ArtifactId,
    /// Whether this artifact has been used in a subsequent operation
    pub consumed: bool,
    pub sub_type: CompositeSolidSubType,
    /// Constituent solids of the composite solid.
    pub solid_ids: Vec<ArtifactId>,
    /// Tool solids used for asymmetric operations like subtract.
    pub tool_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
    /// This is the ID of the composite solid that this is part of, if any, as a
    /// composite solid can be used as input for another composite solid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composite_solid_id: Option<ArtifactId>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum CompositeSolidSubType {
    Intersect,
    Subtract,
    Union,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Plane {
    pub id: ArtifactId,
    pub path_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Path {
    pub id: ArtifactId,
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
    /// The hole, if any, from a subtract2d() call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inner_path_id: Option<ArtifactId>,
    /// The `Path` that this is a hole of, if any. The inverse link of
    /// `inner_path_id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outer_path_id: Option<ArtifactId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: ArtifactId,
    pub path_id: ArtifactId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<ArtifactId>,
    pub edge_ids: Vec<ArtifactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_cut_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
    pub common_surface_ids: Vec<ArtifactId>,
}

/// A sweep is a more generic term for extrude, revolve, loft, and sweep.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Sweep {
    pub id: ArtifactId,
    pub sub_type: SweepSubType,
    pub path_id: ArtifactId,
    pub surface_ids: Vec<ArtifactId>,
    pub edge_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
    /// ID of trajectory path for sweep, if any
    /// Only applicable to SweepSubType::Sweep, which can use a trajectory path
    pub trajectory_id: Option<ArtifactId>,
    pub method: kittycad_modeling_cmds::shared::ExtrudeMethod,
    /// Whether this artifact has been used in a subsequent operation
    pub consumed: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum SweepSubType {
    Extrusion,
    ExtrusionTwist,
    Revolve,
    RevolveAboutEdge,
    Loft,
    Sweep,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Solid2d {
    pub id: ArtifactId,
    pub path_id: ArtifactId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct PlaneOfFace {
    pub id: ArtifactId,
    pub face_id: ArtifactId,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct StartSketchOnFace {
    pub id: ArtifactId,
    pub face_id: ArtifactId,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct StartSketchOnPlane {
    pub id: ArtifactId,
    pub plane_id: ArtifactId,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchBlock {
    pub id: ArtifactId,
    /// The plane ID if the sketch block is on a specific plane, None if it's on a default plane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plane_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
    /// The sketch ID (ObjectId) for the sketch scene object.
    pub sketch_id: ObjectId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
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
    pub cmd_id: uuid::Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
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
    pub cmd_id: uuid::Uuid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum CapSubType {
    Start,
    End,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct SweepEdge {
    pub id: ArtifactId,
    pub sub_type: SweepEdgeSubType,
    pub seg_id: ArtifactId,
    pub cmd_id: uuid::Uuid,
    // This is only used for sorting, not for the actual artifact.
    #[serde(skip)]
    pub index: usize,
    pub sweep_id: ArtifactId,
    pub common_surface_ids: Vec<ArtifactId>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum SweepEdgeSubType {
    Opposite,
    Adjacent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum EdgeCutSubType {
    Fillet,
    Chamfer,
    Custom,
}

impl From<kcmc::shared::CutType> for EdgeCutSubType {
    fn from(cut_type: kcmc::shared::CutType) -> Self {
        match cut_type {
            kcmc::shared::CutType::Fillet => EdgeCutSubType::Fillet,
            kcmc::shared::CutType::Chamfer => EdgeCutSubType::Chamfer,
        }
    }
}

impl From<kcmc::shared::CutTypeV2> for EdgeCutSubType {
    fn from(cut_type: kcmc::shared::CutTypeV2) -> Self {
        match cut_type {
            kcmc::shared::CutTypeV2::Fillet { .. } => EdgeCutSubType::Fillet,
            kcmc::shared::CutTypeV2::Chamfer { .. } => EdgeCutSubType::Chamfer,
            kcmc::shared::CutTypeV2::Custom { .. } => EdgeCutSubType::Custom,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct EdgeCutEdge {
    pub id: ArtifactId,
    pub edge_cut_id: ArtifactId,
    pub surface_id: ArtifactId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Artifact {
    CompositeSolid(CompositeSolid),
    Plane(Plane),
    Path(Path),
    Segment(Segment),
    Solid2d(Solid2d),
    PlaneOfFace(PlaneOfFace),
    StartSketchOnFace(StartSketchOnFace),
    StartSketchOnPlane(StartSketchOnPlane),
    SketchBlock(SketchBlock),
    Sweep(Sweep),
    Wall(Wall),
    Cap(Cap),
    SweepEdge(SweepEdge),
    EdgeCut(EdgeCut),
    EdgeCutEdge(EdgeCutEdge),
    Helix(Helix),
}

impl Artifact {
    pub(crate) fn id(&self) -> ArtifactId {
        match self {
            Artifact::CompositeSolid(a) => a.id,
            Artifact::Plane(a) => a.id,
            Artifact::Path(a) => a.id,
            Artifact::Segment(a) => a.id,
            Artifact::Solid2d(a) => a.id,
            Artifact::StartSketchOnFace(a) => a.id,
            Artifact::StartSketchOnPlane(a) => a.id,
            Artifact::SketchBlock(a) => a.id,
            Artifact::PlaneOfFace(a) => a.id,
            Artifact::Sweep(a) => a.id,
            Artifact::Wall(a) => a.id,
            Artifact::Cap(a) => a.id,
            Artifact::SweepEdge(a) => a.id,
            Artifact::EdgeCut(a) => a.id,
            Artifact::EdgeCutEdge(a) => a.id,
            Artifact::Helix(a) => a.id,
        }
    }

    /// The [`CodeRef`] for the artifact itself. See also
    /// [`Self::face_code_ref`].
    pub fn code_ref(&self) -> Option<&CodeRef> {
        match self {
            Artifact::CompositeSolid(a) => Some(&a.code_ref),
            Artifact::Plane(a) => Some(&a.code_ref),
            Artifact::Path(a) => Some(&a.code_ref),
            Artifact::Segment(a) => Some(&a.code_ref),
            Artifact::Solid2d(_) => None,
            Artifact::StartSketchOnFace(a) => Some(&a.code_ref),
            Artifact::StartSketchOnPlane(a) => Some(&a.code_ref),
            Artifact::SketchBlock(a) => Some(&a.code_ref),
            Artifact::PlaneOfFace(a) => Some(&a.code_ref),
            Artifact::Sweep(a) => Some(&a.code_ref),
            Artifact::Wall(_) => None,
            Artifact::Cap(_) => None,
            Artifact::SweepEdge(_) => None,
            Artifact::EdgeCut(a) => Some(&a.code_ref),
            Artifact::EdgeCutEdge(_) => None,
            Artifact::Helix(a) => Some(&a.code_ref),
        }
    }

    /// The [`CodeRef`] referring to the face artifact that it's on, not the
    /// artifact itself.
    pub fn face_code_ref(&self) -> Option<&CodeRef> {
        match self {
            Artifact::CompositeSolid(_)
            | Artifact::Plane(_)
            | Artifact::Path(_)
            | Artifact::Segment(_)
            | Artifact::Solid2d(_)
            | Artifact::StartSketchOnFace(_)
            | Artifact::PlaneOfFace(_)
            | Artifact::StartSketchOnPlane(_)
            | Artifact::SketchBlock(_)
            | Artifact::Sweep(_) => None,
            Artifact::Wall(a) => Some(&a.face_code_ref),
            Artifact::Cap(a) => Some(&a.face_code_ref),
            Artifact::SweepEdge(_) | Artifact::EdgeCut(_) | Artifact::EdgeCutEdge(_) | Artifact::Helix(_) => None,
        }
    }

    /// The IDs pointing back to prior nodes in a depth-first traversal of
    /// the graph.  This should be disjoint with `child_ids`.
    pub(crate) fn back_edges(&self) -> Vec<ArtifactId> {
        match self {
            Artifact::CompositeSolid(a) => {
                let mut ids = a.solid_ids.clone();
                ids.extend(a.tool_ids.iter());
                ids
            }
            Artifact::Plane(_) => Vec::new(),
            Artifact::Path(a) => {
                let mut ids = vec![a.plane_id];
                if let Some(inner_path_id) = a.inner_path_id {
                    ids.push(inner_path_id);
                }
                if let Some(outer_path_id) = a.outer_path_id {
                    ids.push(outer_path_id);
                }
                ids
            }
            Artifact::Segment(a) => vec![a.path_id],
            Artifact::Solid2d(a) => vec![a.path_id],
            Artifact::StartSketchOnFace(a) => vec![a.face_id],
            Artifact::StartSketchOnPlane(a) => vec![a.plane_id],
            Artifact::SketchBlock(a) => a.plane_id.map(|id| vec![id]).unwrap_or_default(),
            Artifact::PlaneOfFace(a) => vec![a.face_id],
            Artifact::Sweep(a) => vec![a.path_id],
            Artifact::Wall(a) => vec![a.seg_id, a.sweep_id],
            Artifact::Cap(a) => vec![a.sweep_id],
            Artifact::SweepEdge(a) => vec![a.seg_id, a.sweep_id],
            Artifact::EdgeCut(a) => vec![a.consumed_edge_id],
            Artifact::EdgeCutEdge(a) => vec![a.edge_cut_id],
            Artifact::Helix(a) => a.axis_id.map(|id| vec![id]).unwrap_or_default(),
        }
    }

    /// The child IDs of this artifact, used to do a depth-first traversal of
    /// the graph.
    pub(crate) fn child_ids(&self) -> Vec<ArtifactId> {
        match self {
            Artifact::CompositeSolid(a) => {
                // Note: Don't include these since they're parents: solid_ids,
                // tool_ids.
                let mut ids = Vec::new();
                if let Some(composite_solid_id) = a.composite_solid_id {
                    ids.push(composite_solid_id);
                }
                ids
            }
            Artifact::Plane(a) => a.path_ids.clone(),
            Artifact::Path(a) => {
                // Note: Don't include these since they're parents: plane_id,
                // inner_path_id, outer_path_id.
                let mut ids = a.seg_ids.clone();
                if let Some(sweep_id) = a.sweep_id {
                    ids.push(sweep_id);
                }
                if let Some(solid2d_id) = a.solid2d_id {
                    ids.push(solid2d_id);
                }
                if let Some(composite_solid_id) = a.composite_solid_id {
                    ids.push(composite_solid_id);
                }
                ids
            }
            Artifact::Segment(a) => {
                // Note: Don't include these since they're parents: path_id.
                let mut ids = Vec::new();
                if let Some(surface_id) = a.surface_id {
                    ids.push(surface_id);
                }
                ids.extend(&a.edge_ids);
                if let Some(edge_cut_id) = a.edge_cut_id {
                    ids.push(edge_cut_id);
                }
                ids.extend(&a.common_surface_ids);
                ids
            }
            Artifact::Solid2d(_) => {
                // Note: Don't include these since they're parents: path_id.
                Vec::new()
            }
            Artifact::StartSketchOnFace { .. } => {
                // Note: Don't include these since they're parents: face_id.
                Vec::new()
            }
            Artifact::StartSketchOnPlane { .. } => {
                // Note: Don't include these since they're parents: plane_id.
                Vec::new()
            }
            Artifact::SketchBlock { .. } => {
                // Note: Don't include these since they're parents: plane_id (if present).
                Vec::new()
            }
            Artifact::PlaneOfFace { .. } => {
                // Note: Don't include these since they're parents: face_id.
                Vec::new()
            }
            Artifact::Sweep(a) => {
                // Note: Don't include these since they're parents: path_id.
                let mut ids = Vec::new();
                ids.extend(&a.surface_ids);
                ids.extend(&a.edge_ids);
                ids
            }
            Artifact::Wall(a) => {
                // Note: Don't include these since they're parents: seg_id,
                // sweep_id.
                let mut ids = Vec::new();
                ids.extend(&a.edge_cut_edge_ids);
                ids.extend(&a.path_ids);
                ids
            }
            Artifact::Cap(a) => {
                // Note: Don't include these since they're parents: sweep_id.
                let mut ids = Vec::new();
                ids.extend(&a.edge_cut_edge_ids);
                ids.extend(&a.path_ids);
                ids
            }
            Artifact::SweepEdge(a) => {
                // Note: Don't include these since they're parents: seg_id,
                // sweep_id.
                let mut ids = Vec::new();
                ids.extend(&a.common_surface_ids);
                ids
            }
            Artifact::EdgeCut(a) => {
                // Note: Don't include these since they're parents:
                // consumed_edge_id.
                let mut ids = Vec::new();
                ids.extend(&a.edge_ids);
                if let Some(surface_id) = a.surface_id {
                    ids.push(surface_id);
                }
                ids
            }
            Artifact::EdgeCutEdge(a) => {
                // Note: Don't include these since they're parents: edge_cut_id.
                vec![a.surface_id]
            }
            Artifact::Helix(_) => {
                // Note: Don't include these since they're parents: axis_id.
                Vec::new()
            }
        }
    }

    /// Merge the new artifact into self.  If it can't because it's a different
    /// type, return the new artifact which should be used as a replacement.
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        match self {
            Artifact::CompositeSolid(a) => a.merge(new),
            Artifact::Plane(a) => a.merge(new),
            Artifact::Path(a) => a.merge(new),
            Artifact::Segment(a) => a.merge(new),
            Artifact::Solid2d(_) => Some(new),
            Artifact::StartSketchOnFace { .. } => Some(new),
            Artifact::StartSketchOnPlane { .. } => Some(new),
            Artifact::SketchBlock { .. } => Some(new),
            Artifact::PlaneOfFace { .. } => Some(new),
            Artifact::Sweep(a) => a.merge(new),
            Artifact::Wall(a) => a.merge(new),
            Artifact::Cap(a) => a.merge(new),
            Artifact::SweepEdge(_) => Some(new),
            Artifact::EdgeCut(a) => a.merge(new),
            Artifact::EdgeCutEdge(_) => Some(new),
            Artifact::Helix(a) => a.merge(new),
        }
    }
}

impl CompositeSolid {
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        let Artifact::CompositeSolid(new) = new else {
            return Some(new);
        };
        merge_ids(&mut self.solid_ids, new.solid_ids);
        merge_ids(&mut self.tool_ids, new.tool_ids);
        merge_opt_id(&mut self.composite_solid_id, new.composite_solid_id);
        self.consumed = new.consumed;

        None
    }
}

impl Plane {
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        let Artifact::Plane(new) = new else {
            return Some(new);
        };
        merge_ids(&mut self.path_ids, new.path_ids);

        None
    }
}

impl Path {
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        let Artifact::Path(new) = new else {
            return Some(new);
        };
        merge_opt_id(&mut self.sweep_id, new.sweep_id);
        merge_opt_id(&mut self.trajectory_sweep_id, new.trajectory_sweep_id);
        merge_ids(&mut self.seg_ids, new.seg_ids);
        merge_opt_id(&mut self.solid2d_id, new.solid2d_id);
        merge_opt_id(&mut self.composite_solid_id, new.composite_solid_id);
        merge_opt_id(&mut self.inner_path_id, new.inner_path_id);
        merge_opt_id(&mut self.outer_path_id, new.outer_path_id);
        self.consumed = new.consumed;

        None
    }
}

impl Segment {
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        let Artifact::Segment(new) = new else {
            return Some(new);
        };
        merge_opt_id(&mut self.surface_id, new.surface_id);
        merge_ids(&mut self.edge_ids, new.edge_ids);
        merge_opt_id(&mut self.edge_cut_id, new.edge_cut_id);
        merge_ids(&mut self.common_surface_ids, new.common_surface_ids);

        None
    }
}

impl Sweep {
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        let Artifact::Sweep(new) = new else {
            return Some(new);
        };
        merge_ids(&mut self.surface_ids, new.surface_ids);
        merge_ids(&mut self.edge_ids, new.edge_ids);
        merge_opt_id(&mut self.trajectory_id, new.trajectory_id);
        self.consumed = new.consumed;

        None
    }
}

impl Wall {
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        let Artifact::Wall(new) = new else {
            return Some(new);
        };
        merge_ids(&mut self.edge_cut_edge_ids, new.edge_cut_edge_ids);
        merge_ids(&mut self.path_ids, new.path_ids);

        None
    }
}

impl Cap {
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        let Artifact::Cap(new) = new else {
            return Some(new);
        };
        merge_ids(&mut self.edge_cut_edge_ids, new.edge_cut_edge_ids);
        merge_ids(&mut self.path_ids, new.path_ids);

        None
    }
}

impl EdgeCut {
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        let Artifact::EdgeCut(new) = new else {
            return Some(new);
        };
        merge_opt_id(&mut self.surface_id, new.surface_id);
        merge_ids(&mut self.edge_ids, new.edge_ids);

        None
    }
}

impl Helix {
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        let Artifact::Helix(new) = new else {
            return Some(new);
        };
        merge_opt_id(&mut self.axis_id, new.axis_id);
        merge_opt_id(&mut self.trajectory_sweep_id, new.trajectory_sweep_id);
        self.consumed = new.consumed;

        None
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct ArtifactGraph {
    map: IndexMap<ArtifactId, Artifact>,
    pub(super) item_count: usize,
}

impl ArtifactGraph {
    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    #[cfg(test)]
    pub(crate) fn iter(&self) -> impl Iterator<Item = (&ArtifactId, &Artifact)> {
        self.map.iter()
    }

    pub fn values(&self) -> impl Iterator<Item = &Artifact> {
        self.map.values()
    }

    pub fn clear(&mut self) {
        self.map.clear();
        self.item_count = 0;
    }

    /// Consume the artifact graph and return the map of artifacts.
    fn into_map(self) -> IndexMap<ArtifactId, Artifact> {
        self.map
    }

    /// Output the Mermaid flowchart for the artifact graph.
    /// This generates a Mermaid diagram string that visualizes the artifact graph structure.
    ///
    /// # Arguments
    /// * `include_detailed_info` - If true, includes additional information useful for LLMs:
    ///   - Artifact IDs (UUIDs)
    ///   - Full code reference ranges with module information
    ///   - More detailed node path information
    /// * `module_file_names_json` - Optional JSON string mapping from module ID (number) to ModulePath for displaying file names instead of module IDs
    pub fn to_mermaid_flowchart(
        &self,
        include_detailed_info: bool,
        module_file_names_json: Option<&str>,
    ) -> Result<String, std::fmt::Error> {
        // Deserialize module file names from JSON if provided
        // Note: TypeScript sends {[number]: ModulePath} which JSON serializes as {"0": {...}, "1": {...}}
        // serde_json should handle this automatically for IndexMap with numeric keys
        // However, we need to handle the case where keys are strings in JSON
        let module_file_names: Option<IndexMap<ModuleId, ModulePath>> = if let Some(json) = module_file_names_json {
            // Try deserializing directly first
            match serde_json::from_str::<IndexMap<ModuleId, ModulePath>>(json) {
                Ok(map) => {
                    if !map.is_empty() {
                        Some(map)
                    } else {
                        None
                    }
                }
                Err(_) => {
                    // If direct deserialization fails, try deserializing as a map with string keys
                    // and converting them to ModuleId
                    match serde_json::from_str::<std::collections::HashMap<String, ModulePath>>(json) {
                        Ok(string_map) => {
                            let mut module_map = IndexMap::new();
                            for (key_str, path) in string_map {
                                if let Ok(key_num) = key_str.parse::<u32>() {
                                    // ModuleId::from_usize expects usize, but we have u32
                                    module_map.insert(ModuleId::from_usize(key_num as usize), path);
                                }
                            }
                            if !module_map.is_empty() {
                                Some(module_map)
                            } else {
                                None
                            }
                        }
                        Err(_) => None,
                    }
                }
            }
        } else {
            None
        };
        let mut output = String::new();
        output.push_str("```mermaid\n");
        output.push_str("flowchart LR\n");

        let mut next_id = 1_u32;
        let mut stable_id_map = FnvHashMap::default();

        for id in self.map.keys() {
            stable_id_map.insert(*id, next_id);
            next_id = next_id.checked_add(1).unwrap();
        }

        // Output all nodes first since edge order can change how Mermaid
        // lays out nodes.  This is also where we output more details about
        // the nodes, like their labels.
        self.flowchart_nodes(&mut output, &stable_id_map, "  ", include_detailed_info, module_file_names.as_ref())?;
        self.flowchart_edges(&mut output, &stable_id_map, "  ")?;

        output.push_str("```\n");

        Ok(output)
    }

    /// Output the Mermaid flowchart nodes, one for each artifact.
    fn flowchart_nodes<W: Write>(
        &self,
        output: &mut W,
        stable_id_map: &FnvHashMap<ArtifactId, u32>,
        prefix: &str,
        include_detailed_info: bool,
        module_file_names: Option<&IndexMap<ModuleId, ModulePath>>,
    ) -> std::fmt::Result {
        // Artifact ID of the path is the key.  The value is a list of
        // artifact IDs in that group.
        let mut groups = IndexMap::new();
        let mut ungrouped = Vec::new();

        for artifact in self.map.values() {
            let id = artifact.id();

            let grouped = match artifact {
                Artifact::CompositeSolid(_) => false,
                Artifact::Plane(_) => false,
                Artifact::Path(_) => {
                    groups.entry(id).or_insert_with(Vec::new).push(id);
                    true
                }
                Artifact::Segment(segment) => {
                    let path_id = segment.path_id;
                    groups.entry(path_id).or_insert_with(Vec::new).push(id);
                    true
                }
                Artifact::Solid2d(solid2d) => {
                    let path_id = solid2d.path_id;
                    groups.entry(path_id).or_insert_with(Vec::new).push(id);
                    true
                }
                Artifact::StartSketchOnFace { .. }
                | Artifact::StartSketchOnPlane { .. }
                | Artifact::SketchBlock { .. }
                | Artifact::PlaneOfFace { .. }
                | Artifact::Sweep(_)
                | Artifact::Wall(_)
                | Artifact::Cap(_)
                | Artifact::SweepEdge(_)
                | Artifact::EdgeCut(_)
                | Artifact::EdgeCutEdge(_)
                | Artifact::Helix(_) => false,
            };
            if !grouped {
                ungrouped.push(id);
            }
        }

        for (group_id, artifact_ids) in groups {
            let group_id = *stable_id_map.get(&group_id).unwrap();
            writeln!(output, "{prefix}subgraph path{group_id} [Path]")?;
            let indented = format!("{prefix}  ");
            for artifact_id in artifact_ids {
                let artifact = self.map.get(&artifact_id).unwrap();
                let id = *stable_id_map.get(&artifact_id).unwrap();
                self.flowchart_node(output, artifact, artifact_id, id, &indented, include_detailed_info, module_file_names)?;
            }
            writeln!(output, "{prefix}end")?;
        }

        for artifact_id in ungrouped {
            let artifact = self.map.get(&artifact_id).unwrap();
            let id = *stable_id_map.get(&artifact_id).unwrap();
            self.flowchart_node(output, artifact, artifact_id, id, prefix, include_detailed_info, module_file_names)?;
        }

        Ok(())
    }

    fn flowchart_node<W: Write>(
        &self,
        output: &mut W,
        artifact: &Artifact,
        artifact_id: ArtifactId,
        id: u32,
        prefix: &str,
        include_detailed_info: bool,
        module_file_names: Option<&IndexMap<ModuleId, ModulePath>>,
    ) -> std::fmt::Result {
        // Format code reference for display
        fn code_ref_display(
            code_ref: &CodeRef,
            detailed: bool,
            module_file_names: Option<&IndexMap<ModuleId, ModulePath>>,
        ) -> String {
            let range = code_ref.range;
            let module_id = range.module_id();
            let module_id_usize = module_id.as_usize();

            // Get file name if available - use it in both detailed and non-detailed modes
            let file_name_str = if let Some(module_file_names) = module_file_names {
                if let Some(module_path) = module_file_names.get(&module_id) {
                    format_module_path(module_path)
                } else {
                    format!("mod:{}", module_id_usize)
                }
            } else {
                format!("mod:{}", module_id_usize)
            };

            if detailed {
                format!(
                    "range:[{}-{}] {}",
                    range.start(),
                    range.end(),
                    file_name_str
                )
            } else {
                // In non-detailed mode, still show file name if available, otherwise show module ID
                if module_file_names.is_some() && module_file_names.and_then(|m| m.get(&module_id)).is_some() {
                    format!("[{}-{}] {}", range.start(), range.end(), file_name_str)
                } else {
                    format!("{:?}", [range.start(), range.end(), module_id_usize])
                }
            }
        }

        // Format ModulePath for display
        fn format_module_path(module_path: &ModulePath) -> String {
            match module_path {
                ModulePath::Main => "main".to_string(),
                ModulePath::Local { value, .. } => {
                    // Use the file name if available, otherwise use the full path
                    value.file_name().unwrap_or_else(|| value.to_string())
                }
                ModulePath::Std { value } => format!("std::{}", value),
            }
        }

        // Format artifact ID for display (only in detailed mode)
        fn format_artifact_id(artifact_id: ArtifactId, detailed: bool) -> String {
            if detailed {
                format!("<br>id:{:?}", artifact_id)
            } else {
                String::new()
            }
        }

        fn node_path_display<W: Write>(
            output: &mut W,
            prefix: &str,
            label: Option<&str>,
            code_ref: &CodeRef,
            detailed: bool,
        ) -> std::fmt::Result {
            // %% is a mermaid comment. Prefix is increased one level since it's
            // a child of the line above it.
            let label = label.unwrap_or("");
            if detailed {
                if !code_ref.node_path.is_empty() {
                    writeln!(output, "{prefix}  %% {label}NodePath: {:?}", code_ref.node_path.steps)?;
                }
                // Don't show "Missing NodePath" - some artifacts legitimately don't have node paths
            }
            // In non-detailed mode, don't show node path information
            Ok(())
        }

        match artifact {
            Artifact::CompositeSolid(composite_solid) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(&composite_solid.code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"CompositeSolid {:?}<br>{}{}\"]",
                    composite_solid.sub_type, code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, &composite_solid.code_ref, include_detailed_info)?;
            }
            Artifact::Plane(plane) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(&plane.code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"Plane<br>{}{}\"]",
                    code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, &plane.code_ref, include_detailed_info)?;
            }
            Artifact::Path(path) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(&path.code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"Path<br>{}{}\"]",
                    code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, &path.code_ref, include_detailed_info)?;
            }
            Artifact::Segment(segment) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(&segment.code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"Segment<br>{}{}\"]",
                    code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, &segment.code_ref, include_detailed_info)?;
            }
            Artifact::Solid2d(_solid2d) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                if include_detailed_info {
                    writeln!(output, "{prefix}{id}[\"Solid2d{}\"]", id_str)?;
                    // Note: Solid2d doesn't have a direct code ref - it's derived from paths
                    // Trace back through the graph edges to find the source path
                    writeln!(output, "{prefix}  %% Derived from parent artifacts (path)")?;
                } else {
                    writeln!(output, "{prefix}{id}[Solid2d]")?;
                }
            }
            Artifact::StartSketchOnFace(StartSketchOnFace { code_ref, .. }) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"StartSketchOnFace<br>{}{}\"]",
                    code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, code_ref, include_detailed_info)?;
            }
            Artifact::StartSketchOnPlane(StartSketchOnPlane { code_ref, .. }) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"StartSketchOnPlane<br>{}{}\"]",
                    code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, code_ref, include_detailed_info)?;
            }
            Artifact::SketchBlock(SketchBlock { code_ref, .. }) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"SketchBlock<br>{}{}\"]",
                    code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, code_ref, include_detailed_info)?;
            }
            Artifact::PlaneOfFace(PlaneOfFace { code_ref, .. }) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"PlaneOfFace<br>{}{}\"]",
                    code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, code_ref, include_detailed_info)?;
            }
            Artifact::Sweep(sweep) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(&sweep.code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"Sweep {:?}<br>{}{}\"]",
                    sweep.sub_type, code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, &sweep.code_ref, include_detailed_info)?;
            }
            Artifact::Wall(wall) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                if include_detailed_info {
                    let face_code_ref_str = code_ref_display(&wall.face_code_ref, true, module_file_names);
                    writeln!(output, "{prefix}{id}[\"Wall<br>face:{}{}\"]", face_code_ref_str, id_str)?;
                    // Note: Walls don't have direct code refs - they're derived from segments and extrude operations
                    // Trace back through the graph edges to find the source segment and extrude operation
                    writeln!(output, "{prefix}  %% Derived from parent artifacts (segment + extrude)")?;
                } else {
                    writeln!(output, "{prefix}{id}[Wall]")?;
                }
                // Don't show face_code_ref node path - it's not the wall's direct source
            }
            Artifact::Cap(cap) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                if include_detailed_info {
                    let face_code_ref_str = code_ref_display(&cap.face_code_ref, true, module_file_names);
                    writeln!(output, "{prefix}{id}[\"Cap {:?}<br>face:{}{}\"]", cap.sub_type, face_code_ref_str, id_str)?;
                    // Note: Caps don't have direct code refs - they're derived from extrude operations
                    // Trace back through the graph edges to find the source extrude operation
                    writeln!(output, "{prefix}  %% Derived from parent artifacts (extrude operation)")?;
                } else {
                    writeln!(output, "{prefix}{id}[\"Cap {:?}\"]", cap.sub_type)?;
                }
                // Don't show face_code_ref node path - it's not the cap's direct source
            }
            Artifact::SweepEdge(sweep_edge) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                if include_detailed_info {
                    writeln!(output, "{prefix}{id}[\"SweepEdge {:?}{}\"]", sweep_edge.sub_type, id_str)?;
                    // Note: SweepEdges don't have direct code refs - they're derived from sweep operations
                    // Trace back through the graph edges to find the source sweep operation
                    writeln!(output, "{prefix}  %% Derived from parent artifacts (sweep operation)")?;
                } else {
                    writeln!(output, "{prefix}{id}[\"SweepEdge {:?}\"]", sweep_edge.sub_type)?;
                }
            }
            Artifact::EdgeCut(edge_cut) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(&edge_cut.code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"EdgeCut {:?}<br>{}{}\"]",
                    edge_cut.sub_type, code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, &edge_cut.code_ref, include_detailed_info)?;
            }
            Artifact::EdgeCutEdge(_edge_cut_edge) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                if include_detailed_info {
                    writeln!(output, "{prefix}{id}[\"EdgeCutEdge{}\"]", id_str)?;
                    // Note: EdgeCutEdges don't have direct code refs - they're derived from edge cut operations
                    // Trace back through the graph edges to find the source edge cut operation
                    writeln!(output, "{prefix}  %% Derived from parent artifacts (edge cut operation)")?;
                } else {
                    writeln!(output, "{prefix}{id}[EdgeCutEdge]")?;
                }
            }
            Artifact::Helix(helix) => {
                let id_str = format_artifact_id(artifact_id, include_detailed_info);
                let code_ref_str = code_ref_display(&helix.code_ref, include_detailed_info, module_file_names);
                writeln!(
                    output,
                    "{prefix}{id}[\"Helix<br>{}{}\"]",
                    code_ref_str, id_str
                )?;
                node_path_display(output, prefix, None, &helix.code_ref, include_detailed_info)?;
            }
        }
        Ok(())
    }

    fn flowchart_edges<W: Write>(
        &self,
        output: &mut W,
        stable_id_map: &FnvHashMap<ArtifactId, u32>,
        prefix: &str,
    ) -> Result<(), std::fmt::Error> {
        // Helper types for edge deduplication
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        enum EdgeDirection {
            Forward,
            Backward,
            Bidirectional,
        }

        impl EdgeDirection {
            fn merge(&self, other: EdgeDirection) -> EdgeDirection {
                match self {
                    EdgeDirection::Forward => match other {
                        EdgeDirection::Forward => EdgeDirection::Forward,
                        EdgeDirection::Backward => EdgeDirection::Bidirectional,
                        EdgeDirection::Bidirectional => EdgeDirection::Bidirectional,
                    },
                    EdgeDirection::Backward => match other {
                        EdgeDirection::Forward => EdgeDirection::Bidirectional,
                        EdgeDirection::Backward => EdgeDirection::Backward,
                        EdgeDirection::Bidirectional => EdgeDirection::Bidirectional,
                    },
                    EdgeDirection::Bidirectional => EdgeDirection::Bidirectional,
                }
            }
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        enum EdgeFlow {
            SourceToTarget,
            TargetToSource,
        }

        impl EdgeFlow {
            fn reverse(&self) -> EdgeFlow {
                match self {
                    EdgeFlow::SourceToTarget => EdgeFlow::TargetToSource,
                    EdgeFlow::TargetToSource => EdgeFlow::SourceToTarget,
                }
            }
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        enum EdgeKind {
            PathToSweep,
            Other,
        }

        #[derive(Debug, Clone, PartialEq, Eq)]
        struct EdgeInfo {
            direction: EdgeDirection,
            flow: EdgeFlow,
            kind: EdgeKind,
        }

        type Edges = IndexMap<(u32, u32), EdgeInfo>;

        // Mermaid will display two edges in either direction, even using
        // the `---` edge type. So we need to deduplicate them.
        fn add_unique_edge(edges: &mut Edges, source_id: u32, target_id: u32, flow: EdgeFlow, kind: EdgeKind) {
            if source_id == target_id {
                // Self edge.  Skip it.
                return;
            }
            // The key is the node IDs in canonical order.
            let a = source_id.min(target_id);
            let b = source_id.max(target_id);
            let new_direction = if a == source_id {
                EdgeDirection::Forward
            } else {
                EdgeDirection::Backward
            };
            let initial_flow = if a == source_id { flow } else { flow.reverse() };
            let edge = edges.entry((a, b)).or_insert(EdgeInfo {
                direction: new_direction,
                flow: initial_flow,
                kind,
            });
            // Merge with existing edge.
            edge.direction = edge.direction.merge(new_direction);
        }

        // Collect all edges to deduplicate them.
        let mut edges = IndexMap::default();
        for artifact in self.map.values() {
            let source_id = *stable_id_map.get(&artifact.id()).unwrap();
            // In Mermaid, the textual order defines the rank, even though the
            // edge arrow can go in either direction.
            //
            // Back edges: parent <- self
            // Child edges: self -> child
            for (target_id, flow) in artifact
                .back_edges()
                .into_iter()
                .zip(std::iter::repeat(EdgeFlow::TargetToSource))
                .chain(
                    artifact
                        .child_ids()
                        .into_iter()
                        .zip(std::iter::repeat(EdgeFlow::SourceToTarget)),
                )
            {
                let Some(target) = self.map.get(&target_id) else {
                    continue;
                };
                let edge_kind = match (artifact, target) {
                    (Artifact::Path(_), Artifact::Sweep(_)) | (Artifact::Sweep(_), Artifact::Path(_)) => {
                        EdgeKind::PathToSweep
                    }
                    _ => EdgeKind::Other,
                };
                let target_id = *stable_id_map.get(&target_id).unwrap();
                add_unique_edge(&mut edges, source_id, target_id, flow, edge_kind);
            }
        }

        // Output the edges.
        edges.sort_by(|ak, _, bk, _| if ak.0 == bk.0 { ak.1.cmp(&bk.1) } else { ak.0.cmp(&bk.0) });
        for ((source_id, target_id), edge) in edges {
            let extra = match edge.kind {
                // Extra length.  This is needed to make the graph layout more
                // legible.  Without it, the sweep will be at the same rank as
                // the path's segments, and the sweep's edges overlap with the
                // segment edges a lot.
                EdgeKind::PathToSweep => "-",
                EdgeKind::Other => "",
            };
            match edge.flow {
                EdgeFlow::SourceToTarget => match edge.direction {
                    EdgeDirection::Forward => {
                        writeln!(output, "{prefix}{source_id} x{extra}--> {target_id}")?;
                    }
                    EdgeDirection::Backward => {
                        writeln!(output, "{prefix}{source_id} <{extra}--x {target_id}")?;
                    }
                    EdgeDirection::Bidirectional => {
                        writeln!(output, "{prefix}{source_id} {extra}--- {target_id}")?;
                    }
                },
                EdgeFlow::TargetToSource => match edge.direction {
                    EdgeDirection::Forward => {
                        writeln!(output, "{prefix}{target_id} x{extra}--> {source_id}")?;
                    }
                    EdgeDirection::Backward => {
                        writeln!(output, "{prefix}{target_id} <{extra}--x {source_id}")?;
                    }
                    EdgeDirection::Bidirectional => {
                        writeln!(output, "{prefix}{target_id} {extra}--- {source_id}")?;
                    }
                },
            }
        }

        Ok(())
    }
}

/// Build the artifact graph from the artifact commands and the responses.  The
/// initial graph is the graph cached from a previous execution.  NodePaths of
/// `exec_artifacts` are filled in from the AST.
pub(super) fn build_artifact_graph(
    artifact_commands: &[ArtifactCommand],
    responses: &IndexMap<Uuid, WebSocketResponse>,
    ast: &Node<Program>,
    exec_artifacts: &mut IndexMap<ArtifactId, Artifact>,
    initial_graph: ArtifactGraph,
    programs: &crate::execution::ProgramLookup,
) -> Result<ArtifactGraph, KclError> {
    let item_count = initial_graph.item_count;
    let mut map = initial_graph.into_map();

    let mut path_to_plane_id_map = FnvHashMap::default();
    let mut current_plane_id = None;

    // Fill in NodePaths for artifacts that were added directly to the map
    // during execution.
    for exec_artifact in exec_artifacts.values_mut() {
        // Note: We only have access to the new AST. So if these artifacts
        // somehow came from cached AST, this won't fill in anything.
        fill_in_node_paths(exec_artifact, programs, item_count);
    }

    for artifact_command in artifact_commands {
        if let ModelingCmd::EnableSketchMode(EnableSketchMode { entity_id, .. }) = artifact_command.command {
            current_plane_id = Some(entity_id);
        }
        // If we get a start path command, we need to set the plane ID to the
        // current plane ID.
        // THIS IS THE ONLY THING WE CAN ASSUME IS ALWAYS SEQUENTIAL SINCE ITS PART OF THE
        // SAME ATOMIC COMMANDS BATCHING.
        if let ModelingCmd::StartPath(_) = artifact_command.command
            && let Some(plane_id) = current_plane_id
        {
            path_to_plane_id_map.insert(artifact_command.cmd_id, plane_id);
        }
        if let ModelingCmd::SketchModeDisable(_) = artifact_command.command {
            current_plane_id = None;
        }

        let flattened_responses = flatten_modeling_command_responses(responses);
        let artifact_updates = artifacts_to_update(
            &map,
            artifact_command,
            &flattened_responses,
            &path_to_plane_id_map,
            programs,
            item_count,
            exec_artifacts,
        )?;
        for artifact in artifact_updates {
            // Merge with existing artifacts.
            merge_artifact_into_map(&mut map, artifact);
        }
    }

    for exec_artifact in exec_artifacts.values() {
        merge_artifact_into_map(&mut map, exec_artifact.clone());
    }

    Ok(ArtifactGraph {
        map,
        item_count: item_count + ast.body.len(),
    })
}

/// These may have been created with placeholder `CodeRef`s because we didn't
/// have the entire AST available. Now we fill them in.
fn fill_in_node_paths(artifact: &mut Artifact, programs: &crate::execution::ProgramLookup, cached_body_items: usize) {
    match artifact {
        Artifact::StartSketchOnFace(face) => {
            if face.code_ref.node_path.is_empty() {
                face.code_ref.node_path =
                    NodePath::from_range(programs, cached_body_items, face.code_ref.range).unwrap_or_default();
            }
        }
        Artifact::StartSketchOnPlane(plane) => {
            if plane.code_ref.node_path.is_empty() {
                plane.code_ref.node_path =
                    NodePath::from_range(programs, cached_body_items, plane.code_ref.range).unwrap_or_default();
            }
        }
        Artifact::SketchBlock(block) => {
            if block.code_ref.node_path.is_empty() {
                block.code_ref.node_path =
                    NodePath::from_range(programs, cached_body_items, block.code_ref.range).unwrap_or_default();
            }
        }
        _ => {}
    }
}

/// Flatten the responses into a map of command IDs to modeling command
/// responses.  The raw responses from the engine contain batches.
fn flatten_modeling_command_responses(
    responses: &IndexMap<Uuid, WebSocketResponse>,
) -> FnvHashMap<Uuid, OkModelingCmdResponse> {
    let mut map = FnvHashMap::default();
    for (cmd_id, ws_response) in responses {
        let WebSocketResponse::Success(response) = ws_response else {
            // Response not successful.
            continue;
        };
        match &response.resp {
            OkWebSocketResponseData::Modeling { modeling_response } => {
                map.insert(*cmd_id, modeling_response.clone());
            }
            OkWebSocketResponseData::ModelingBatch { responses } =>
            {
                #[expect(
                    clippy::iter_over_hash_type,
                    reason = "Since we're moving entries to another unordered map, it's fine that the order is undefined"
                )]
                for (cmd_id, batch_response) in responses {
                    if let BatchResponse::Success {
                        response: modeling_response,
                    } = batch_response
                    {
                        map.insert(*cmd_id.as_ref(), modeling_response.clone());
                    }
                }
            }
            OkWebSocketResponseData::IceServerInfo { .. }
            | OkWebSocketResponseData::TrickleIce { .. }
            | OkWebSocketResponseData::SdpAnswer { .. }
            | OkWebSocketResponseData::Export { .. }
            | OkWebSocketResponseData::MetricsRequest { .. }
            | OkWebSocketResponseData::ModelingSessionData { .. }
            | OkWebSocketResponseData::Debug { .. }
            | OkWebSocketResponseData::Pong { .. } => {}
        }
    }

    map
}

fn merge_artifact_into_map(map: &mut IndexMap<ArtifactId, Artifact>, new_artifact: Artifact) {
    let id = new_artifact.id();
    let Some(old_artifact) = map.get_mut(&id) else {
        // No old artifact exists.  Insert the new one.
        map.insert(id, new_artifact);
        return;
    };

    if let Some(replacement) = old_artifact.merge(new_artifact) {
        *old_artifact = replacement;
    }
}

/// Merge the new IDs into the base vector, avoiding duplicates.  This is O(nm)
/// runtime.  Rationale is that most of the ID collections in the artifact graph
/// are pretty small, but we may want to change this in the future.
fn merge_ids(base: &mut Vec<ArtifactId>, new: Vec<ArtifactId>) {
    let original_len = base.len();
    for id in new {
        // Don't bother inspecting new items that we just pushed.
        let original_base = &base[..original_len];
        if !original_base.contains(&id) {
            base.push(id);
        }
    }
}

/// Merge optional Artifact ID
fn merge_opt_id(base: &mut Option<ArtifactId>, new: Option<ArtifactId>) {
    // Always use the new one, even if it clears it.
    *base = new;
}

fn artifacts_to_update(
    artifacts: &IndexMap<ArtifactId, Artifact>,
    artifact_command: &ArtifactCommand,
    responses: &FnvHashMap<Uuid, OkModelingCmdResponse>,
    path_to_plane_id_map: &FnvHashMap<Uuid, Uuid>,
    programs: &crate::execution::ProgramLookup,
    cached_body_items: usize,
    exec_artifacts: &IndexMap<ArtifactId, Artifact>,
) -> Result<Vec<Artifact>, KclError> {
    let uuid = artifact_command.cmd_id;
    let response = responses.get(&uuid);

    // TODO: Build path-to-node from artifact_command source range.  Right now,
    // we're serializing an empty array, and the TS wrapper fills it in with the
    // correct value based on NodePath.
    let path_to_node = Vec::new();
    let range = artifact_command.range;
    let node_path = NodePath::from_range(programs, cached_body_items, range).unwrap_or_default();
    let code_ref = CodeRef {
        range,
        node_path,
        path_to_node,
    };

    let id = ArtifactId::new(uuid);
    let cmd = &artifact_command.command;

    match cmd {
        ModelingCmd::MakePlane(_) => {
            if range.is_synthetic() {
                return Ok(Vec::new());
            }
            // If we're calling `make_plane` and the code range doesn't end at
            // `0` it's not a default plane, but a custom one from the
            // offsetPlane standard library function.
            return Ok(vec![Artifact::Plane(Plane {
                id,
                path_ids: Vec::new(),
                code_ref,
            })]);
        }
        ModelingCmd::FaceIsPlanar(FaceIsPlanar { object_id, .. }) => {
            return Ok(vec![Artifact::PlaneOfFace(PlaneOfFace {
                id,
                face_id: object_id.into(),
                code_ref,
            })]);
        }
        ModelingCmd::EnableSketchMode(EnableSketchMode { entity_id, .. }) => {
            let existing_plane = artifacts.get(&ArtifactId::new(*entity_id));
            match existing_plane {
                Some(Artifact::Wall(wall)) => {
                    return Ok(vec![Artifact::Wall(Wall {
                        id: entity_id.into(),
                        seg_id: wall.seg_id,
                        edge_cut_edge_ids: wall.edge_cut_edge_ids.clone(),
                        sweep_id: wall.sweep_id,
                        path_ids: wall.path_ids.clone(),
                        face_code_ref: wall.face_code_ref.clone(),
                        cmd_id: artifact_command.cmd_id,
                    })]);
                }
                Some(Artifact::Cap(cap)) => {
                    return Ok(vec![Artifact::Cap(Cap {
                        id: entity_id.into(),
                        sub_type: cap.sub_type,
                        edge_cut_edge_ids: cap.edge_cut_edge_ids.clone(),
                        sweep_id: cap.sweep_id,
                        path_ids: cap.path_ids.clone(),
                        face_code_ref: cap.face_code_ref.clone(),
                        cmd_id: artifact_command.cmd_id,
                    })]);
                }
                Some(_) | None => {
                    let path_ids = match existing_plane {
                        Some(Artifact::Plane(Plane { path_ids, .. })) => path_ids.clone(),
                        _ => Vec::new(),
                    };
                    // Create an entirely new plane
                    return Ok(vec![Artifact::Plane(Plane {
                        id: entity_id.into(),
                        path_ids,
                        code_ref,
                    })]);
                }
            }
        }
        ModelingCmd::StartPath(_) => {
            let mut return_arr = Vec::new();
            let current_plane_id = path_to_plane_id_map.get(&artifact_command.cmd_id).ok_or_else(|| {
                KclError::new_internal(KclErrorDetails::new(
                    format!("Expected a current plane ID when processing StartPath command, but we have none: {id:?}"),
                    vec![range],
                ))
            })?;
            return_arr.push(Artifact::Path(Path {
                id,
                plane_id: (*current_plane_id).into(),
                seg_ids: Vec::new(),
                sweep_id: None,
                trajectory_sweep_id: None,
                solid2d_id: None,
                code_ref,
                composite_solid_id: None,
                inner_path_id: None,
                outer_path_id: None,
                consumed: false,
            }));
            let plane = artifacts.get(&ArtifactId::new(*current_plane_id));
            if let Some(Artifact::Plane(plane)) = plane {
                let plane_code_ref = plane.code_ref.clone();
                return_arr.push(Artifact::Plane(Plane {
                    id: (*current_plane_id).into(),
                    path_ids: vec![id],
                    code_ref: plane_code_ref,
                }));
            }
            if let Some(Artifact::Wall(wall)) = plane {
                return_arr.push(Artifact::Wall(Wall {
                    id: (*current_plane_id).into(),
                    seg_id: wall.seg_id,
                    edge_cut_edge_ids: wall.edge_cut_edge_ids.clone(),
                    sweep_id: wall.sweep_id,
                    path_ids: vec![id],
                    face_code_ref: wall.face_code_ref.clone(),
                    cmd_id: artifact_command.cmd_id,
                }));
            }
            if let Some(Artifact::Cap(cap)) = plane {
                return_arr.push(Artifact::Cap(Cap {
                    id: (*current_plane_id).into(),
                    sub_type: cap.sub_type,
                    edge_cut_edge_ids: cap.edge_cut_edge_ids.clone(),
                    sweep_id: cap.sweep_id,
                    path_ids: vec![id],
                    face_code_ref: cap.face_code_ref.clone(),
                    cmd_id: artifact_command.cmd_id,
                }));
            }
            return Ok(return_arr);
        }
        ModelingCmd::ClosePath(_) | ModelingCmd::ExtendPath(_) => {
            let path_id = ArtifactId::new(match cmd {
                ModelingCmd::ClosePath(c) => c.path_id,
                ModelingCmd::ExtendPath(e) => e.path.into(),
                _ => internal_error!(
                    range,
                    "Close or extend path command variant not handled: id={id:?}, cmd={cmd:?}"
                ),
            });
            let mut return_arr = Vec::new();
            return_arr.push(Artifact::Segment(Segment {
                id,
                path_id,
                surface_id: None,
                edge_ids: Vec::new(),
                edge_cut_id: None,
                code_ref,
                common_surface_ids: Vec::new(),
            }));
            let path = artifacts.get(&path_id);
            if let Some(Artifact::Path(path)) = path {
                let mut new_path = path.clone();
                new_path.seg_ids = vec![id];
                return_arr.push(Artifact::Path(new_path));
            }
            if let Some(OkModelingCmdResponse::ClosePath(close_path)) = response {
                return_arr.push(Artifact::Solid2d(Solid2d {
                    id: close_path.face_id.into(),
                    path_id,
                }));
                if let Some(Artifact::Path(path)) = path {
                    let mut new_path = path.clone();
                    new_path.solid2d_id = Some(close_path.face_id.into());
                    return_arr.push(Artifact::Path(new_path));
                }
            }
            return Ok(return_arr);
        }
        ModelingCmd::EntityMirror(kcmc::EntityMirror {
            ids: original_path_ids, ..
        })
        | ModelingCmd::EntityMirrorAcrossEdge(kcmc::EntityMirrorAcrossEdge {
            ids: original_path_ids, ..
        }) => {
            let face_edge_infos = match response {
                Some(OkModelingCmdResponse::EntityMirror(resp)) => &resp.entity_face_edge_ids,
                Some(OkModelingCmdResponse::EntityMirrorAcrossEdge(resp)) => &resp.entity_face_edge_ids,
                _ => internal_error!(
                    range,
                    "Mirror response variant not handled: id={id:?}, cmd={cmd:?}, response={response:?}"
                ),
            };
            if original_path_ids.len() != face_edge_infos.len() {
                internal_error!(
                    range,
                    "EntityMirror or EntityMirrorAcrossEdge response has different number face edge info than original mirrored paths: id={id:?}, cmd={cmd:?}, response={response:?}"
                );
            }
            let mut return_arr = Vec::new();
            for (face_edge_info, original_path_id) in face_edge_infos.iter().zip(original_path_ids) {
                let original_path_id = ArtifactId::new(*original_path_id);
                let path_id = ArtifactId::new(face_edge_info.object_id);
                // The path may be an existing path that was extended or a new
                // path.
                let mut path = if let Some(Artifact::Path(path)) = artifacts.get(&path_id) {
                    // Existing path.
                    path.clone()
                } else {
                    // It's a new path.  We need the original path to get some
                    // of its info.
                    let Some(Artifact::Path(original_path)) = artifacts.get(&original_path_id) else {
                        // We couldn't find the original path. This is a bug.
                        internal_error!(
                            range,
                            "Couldn't find original path for mirror2d: original_path_id={original_path_id:?}, cmd={cmd:?}"
                        );
                    };
                    Path {
                        id: path_id,
                        plane_id: original_path.plane_id,
                        seg_ids: Vec::new(),
                        sweep_id: None,
                        trajectory_sweep_id: None,
                        solid2d_id: None,
                        code_ref: code_ref.clone(),
                        composite_solid_id: None,
                        inner_path_id: None,
                        outer_path_id: None,
                        consumed: false,
                    }
                };

                face_edge_info.edges.iter().for_each(|edge_id| {
                    let edge_id = ArtifactId::new(*edge_id);
                    return_arr.push(Artifact::Segment(Segment {
                        id: edge_id,
                        path_id: path.id,
                        surface_id: None,
                        edge_ids: Vec::new(),
                        edge_cut_id: None,
                        code_ref: code_ref.clone(),
                        common_surface_ids: Vec::new(),
                    }));
                    // Add the edge ID to the path.
                    path.seg_ids.push(edge_id);
                });

                return_arr.push(Artifact::Path(path));
            }
            return Ok(return_arr);
        }
        ModelingCmd::Extrude(kcmc::Extrude { target, .. })
        | ModelingCmd::TwistExtrude(kcmc::TwistExtrude { target, .. })
        | ModelingCmd::Revolve(kcmc::Revolve { target, .. })
        | ModelingCmd::RevolveAboutEdge(kcmc::RevolveAboutEdge { target, .. })
        | ModelingCmd::ExtrudeToReference(kcmc::ExtrudeToReference { target, .. }) => {
            // Determine the resulting method from the specific command, if provided
            let method = match cmd {
                ModelingCmd::Extrude(kcmc::Extrude { extrude_method, .. }) => *extrude_method,
                ModelingCmd::ExtrudeToReference(kcmc::ExtrudeToReference { extrude_method, .. }) => *extrude_method,
                // TwistExtrude and Sweep don't carry method in the command; treat as Merge
                ModelingCmd::TwistExtrude(_) | ModelingCmd::Sweep(_) => {
                    kittycad_modeling_cmds::shared::ExtrudeMethod::Merge
                }
                // Revolve variants behave like New bodies in std layer
                ModelingCmd::Revolve(_) | ModelingCmd::RevolveAboutEdge(_) => {
                    kittycad_modeling_cmds::shared::ExtrudeMethod::New
                }
                _ => kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
            };
            let sub_type = match cmd {
                ModelingCmd::Extrude(_) => SweepSubType::Extrusion,
                ModelingCmd::ExtrudeToReference(_) => SweepSubType::Extrusion,
                ModelingCmd::TwistExtrude(_) => SweepSubType::ExtrusionTwist,
                ModelingCmd::Revolve(_) => SweepSubType::Revolve,
                ModelingCmd::RevolveAboutEdge(_) => SweepSubType::RevolveAboutEdge,
                _ => internal_error!(range, "Sweep-like command variant not handled: id={id:?}, cmd={cmd:?}",),
            };
            let mut return_arr = Vec::new();
            let target = ArtifactId::from(target);
            return_arr.push(Artifact::Sweep(Sweep {
                id,
                sub_type,
                path_id: target,
                surface_ids: Vec::new(),
                edge_ids: Vec::new(),
                code_ref,
                trajectory_id: None,
                method,
                consumed: false,
            }));
            let path = artifacts.get(&target);
            if let Some(Artifact::Path(path)) = path {
                let mut new_path = path.clone();
                new_path.sweep_id = Some(id);
                new_path.consumed = true;
                return_arr.push(Artifact::Path(new_path));
                if let Some(inner_path_id) = path.inner_path_id
                    && let Some(inner_path_artifact) = artifacts.get(&inner_path_id)
                    && let Artifact::Path(mut inner_path_artifact) = inner_path_artifact.clone()
                {
                    inner_path_artifact.sweep_id = Some(id);
                    inner_path_artifact.consumed = true;
                    return_arr.push(Artifact::Path(inner_path_artifact))
                }
            }
            return Ok(return_arr);
        }
        ModelingCmd::Sweep(kcmc::Sweep { target, trajectory, .. }) => {
            // Determine the resulting method from the specific command, if provided
            let method = kittycad_modeling_cmds::shared::ExtrudeMethod::Merge;
            let sub_type = SweepSubType::Sweep;
            let mut return_arr = Vec::new();
            let target = ArtifactId::from(target);
            let trajectory = ArtifactId::from(trajectory);
            return_arr.push(Artifact::Sweep(Sweep {
                id,
                sub_type,
                path_id: target,
                surface_ids: Vec::new(),
                edge_ids: Vec::new(),
                code_ref,
                trajectory_id: Some(trajectory),
                method,
                consumed: false,
            }));
            let path = artifacts.get(&target);
            if let Some(Artifact::Path(path)) = path {
                let mut new_path = path.clone();
                new_path.sweep_id = Some(id);
                new_path.consumed = true;
                return_arr.push(Artifact::Path(new_path));
                if let Some(inner_path_id) = path.inner_path_id
                    && let Some(inner_path_artifact) = artifacts.get(&inner_path_id)
                    && let Artifact::Path(mut inner_path_artifact) = inner_path_artifact.clone()
                {
                    inner_path_artifact.sweep_id = Some(id);
                    inner_path_artifact.consumed = true;
                    return_arr.push(Artifact::Path(inner_path_artifact))
                }
            }
            if let Some(trajectory_artifact) = artifacts.get(&trajectory) {
                match trajectory_artifact {
                    Artifact::Path(path) => {
                        let mut new_path = path.clone();
                        new_path.trajectory_sweep_id = Some(id);
                        new_path.consumed = true;
                        return_arr.push(Artifact::Path(new_path));
                    }
                    Artifact::Helix(helix) => {
                        let mut new_helix = helix.clone();
                        new_helix.trajectory_sweep_id = Some(id);
                        new_helix.consumed = true;
                        return_arr.push(Artifact::Helix(new_helix));
                    }
                    _ => {}
                }
            };
            return Ok(return_arr);
        }
        ModelingCmd::Loft(loft_cmd) => {
            let Some(OkModelingCmdResponse::Loft(_)) = response else {
                return Ok(Vec::new());
            };
            let mut return_arr = Vec::new();
            return_arr.push(Artifact::Sweep(Sweep {
                id,
                sub_type: SweepSubType::Loft,
                // TODO: Using the first one.  Make sure to revisit this
                // choice, don't think it matters for now.
                path_id: ArtifactId::new(*loft_cmd.section_ids.first().ok_or_else(|| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Expected at least one section ID in Loft command: {id:?}; cmd={cmd:?}"),
                        vec![range],
                    ))
                })?),
                surface_ids: Vec::new(),
                edge_ids: Vec::new(),
                code_ref,
                trajectory_id: None,
                method: kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
                consumed: false,
            }));
            for section_id in &loft_cmd.section_ids {
                let path = artifacts.get(&ArtifactId::new(*section_id));
                if let Some(Artifact::Path(path)) = path {
                    let mut new_path = path.clone();
                    new_path.consumed = true;
                    new_path.sweep_id = Some(id);
                    return_arr.push(Artifact::Path(new_path));
                }
            }
            return Ok(return_arr);
        }
        ModelingCmd::Solid3dGetExtrusionFaceInfo(_) => {
            let Some(OkModelingCmdResponse::Solid3dGetExtrusionFaceInfo(face_info)) = response else {
                return Ok(Vec::new());
            };
            let mut return_arr = Vec::new();
            let mut last_path = None;
            for face in &face_info.faces {
                if face.cap != ExtrusionFaceCapType::None {
                    continue;
                }
                let Some(curve_id) = face.curve_id.map(ArtifactId::new) else {
                    continue;
                };
                let Some(face_id) = face.face_id.map(ArtifactId::new) else {
                    continue;
                };
                let Some(Artifact::Segment(seg)) = artifacts.get(&curve_id) else {
                    continue;
                };
                let Some(Artifact::Path(path)) = artifacts.get(&seg.path_id) else {
                    continue;
                };
                last_path = Some(path);
                let Some(path_sweep_id) = path.sweep_id else {
                    // If the path doesn't have a sweep ID, check if it's a
                    // hole.
                    if path.outer_path_id.is_some() {
                        continue; // hole not handled
                    }
                    return Err(KclError::new_internal(KclErrorDetails::new(
                        format!(
                            "Expected a sweep ID on the path when processing Solid3dGetExtrusionFaceInfo command, but we have none:\n{id:#?}\n{path:#?}"
                        ),
                        vec![range],
                    )));
                };
                let extra_artifact = exec_artifacts.values().find(|a| {
                    if let Artifact::StartSketchOnFace(s) = a {
                        s.face_id == face_id
                    } else if let Artifact::StartSketchOnPlane(s) = a {
                        s.plane_id == face_id
                    } else {
                        false
                    }
                });
                let sketch_on_face_code_ref = extra_artifact
                    .and_then(|a| match a {
                        Artifact::StartSketchOnFace(s) => Some(s.code_ref.clone()),
                        Artifact::StartSketchOnPlane(s) => Some(s.code_ref.clone()),
                        _ => None,
                    })
                    // TODO: If we didn't find it, it's probably a bug.
                    .unwrap_or_default();

                return_arr.push(Artifact::Wall(Wall {
                    id: face_id,
                    seg_id: curve_id,
                    edge_cut_edge_ids: Vec::new(),
                    sweep_id: path_sweep_id,
                    path_ids: Vec::new(),
                    face_code_ref: sketch_on_face_code_ref,
                    cmd_id: artifact_command.cmd_id,
                }));
                let mut new_seg = seg.clone();
                new_seg.surface_id = Some(face_id);
                return_arr.push(Artifact::Segment(new_seg));
                if let Some(Artifact::Sweep(sweep)) = path.sweep_id.and_then(|id| artifacts.get(&id)) {
                    let mut new_sweep = sweep.clone();
                    new_sweep.surface_ids = vec![face_id];
                    return_arr.push(Artifact::Sweep(new_sweep));
                }
            }
            if let Some(path) = last_path {
                for face in &face_info.faces {
                    let sub_type = match face.cap {
                        ExtrusionFaceCapType::Top => CapSubType::End,
                        ExtrusionFaceCapType::Bottom => CapSubType::Start,
                        ExtrusionFaceCapType::None | ExtrusionFaceCapType::Both => continue,
                    };
                    let Some(face_id) = face.face_id.map(ArtifactId::new) else {
                        continue;
                    };
                    let Some(path_sweep_id) = path.sweep_id else {
                        // If the path doesn't have a sweep ID, check if it's a
                        // hole.
                        if path.outer_path_id.is_some() {
                            continue; // hole not handled
                        }
                        return Err(KclError::new_internal(KclErrorDetails::new(
                            format!(
                                "Expected a sweep ID on the path when processing last path's Solid3dGetExtrusionFaceInfo command, but we have none:\n{id:#?}\n{path:#?}"
                            ),
                            vec![range],
                        )));
                    };
                    let extra_artifact = exec_artifacts.values().find(|a| {
                        if let Artifact::StartSketchOnFace(s) = a {
                            s.face_id == face_id
                        } else if let Artifact::StartSketchOnPlane(s) = a {
                            s.plane_id == face_id
                        } else {
                            false
                        }
                    });
                    let sketch_on_face_code_ref = extra_artifact
                        .and_then(|a| match a {
                            Artifact::StartSketchOnFace(s) => Some(s.code_ref.clone()),
                            Artifact::StartSketchOnPlane(s) => Some(s.code_ref.clone()),
                            _ => None,
                        })
                        // TODO: If we didn't find it, it's probably a bug.
                        .unwrap_or_default();
                    return_arr.push(Artifact::Cap(Cap {
                        id: face_id,
                        sub_type,
                        edge_cut_edge_ids: Vec::new(),
                        sweep_id: path_sweep_id,
                        path_ids: Vec::new(),
                        face_code_ref: sketch_on_face_code_ref,
                        cmd_id: artifact_command.cmd_id,
                    }));
                    let Some(Artifact::Sweep(sweep)) = artifacts.get(&path_sweep_id) else {
                        continue;
                    };
                    let mut new_sweep = sweep.clone();
                    new_sweep.surface_ids = vec![face_id];
                    return_arr.push(Artifact::Sweep(new_sweep));
                }
            }
            return Ok(return_arr);
        }
        ModelingCmd::Solid3dGetAdjacencyInfo(kcmc::Solid3dGetAdjacencyInfo { .. }) => {
            let Some(OkModelingCmdResponse::Solid3dGetAdjacencyInfo(info)) = response else {
                return Ok(Vec::new());
            };

            let mut return_arr = Vec::new();
            for (index, edge) in info.edges.iter().enumerate() {
                let Some(original_info) = &edge.original_info else {
                    continue;
                };
                let edge_id = ArtifactId::new(original_info.edge_id);
                let Some(artifact) = artifacts.get(&edge_id) else {
                    continue;
                };
                match artifact {
                    Artifact::Segment(segment) => {
                        let mut new_segment = segment.clone();
                        new_segment.common_surface_ids =
                            original_info.faces.iter().map(|face| ArtifactId::new(*face)).collect();
                        return_arr.push(Artifact::Segment(new_segment));
                    }
                    Artifact::SweepEdge(sweep_edge) => {
                        let mut new_sweep_edge = sweep_edge.clone();
                        new_sweep_edge.common_surface_ids =
                            original_info.faces.iter().map(|face| ArtifactId::new(*face)).collect();
                        return_arr.push(Artifact::SweepEdge(new_sweep_edge));
                    }
                    _ => {}
                };

                let Some(Artifact::Segment(segment)) = artifacts.get(&edge_id) else {
                    continue;
                };
                let Some(surface_id) = segment.surface_id else {
                    continue;
                };
                let Some(Artifact::Wall(wall)) = artifacts.get(&surface_id) else {
                    continue;
                };
                let Some(Artifact::Sweep(sweep)) = artifacts.get(&wall.sweep_id) else {
                    continue;
                };
                let Some(Artifact::Path(_)) = artifacts.get(&sweep.path_id) else {
                    continue;
                };

                if let Some(opposite_info) = &edge.opposite_info {
                    return_arr.push(Artifact::SweepEdge(SweepEdge {
                        id: opposite_info.edge_id.into(),
                        sub_type: SweepEdgeSubType::Opposite,
                        seg_id: edge_id,
                        cmd_id: artifact_command.cmd_id,
                        index,
                        sweep_id: sweep.id,
                        common_surface_ids: opposite_info.faces.iter().map(|face| ArtifactId::new(*face)).collect(),
                    }));
                    let mut new_segment = segment.clone();
                    new_segment.edge_ids = vec![opposite_info.edge_id.into()];
                    return_arr.push(Artifact::Segment(new_segment));
                    let mut new_sweep = sweep.clone();
                    new_sweep.edge_ids = vec![opposite_info.edge_id.into()];
                    return_arr.push(Artifact::Sweep(new_sweep));
                    let mut new_wall = wall.clone();
                    new_wall.edge_cut_edge_ids = vec![opposite_info.edge_id.into()];
                    return_arr.push(Artifact::Wall(new_wall));
                }
                if let Some(adjacent_info) = &edge.adjacent_info {
                    return_arr.push(Artifact::SweepEdge(SweepEdge {
                        id: adjacent_info.edge_id.into(),
                        sub_type: SweepEdgeSubType::Adjacent,
                        seg_id: edge_id,
                        cmd_id: artifact_command.cmd_id,
                        index,
                        sweep_id: sweep.id,
                        common_surface_ids: adjacent_info.faces.iter().map(|face| ArtifactId::new(*face)).collect(),
                    }));
                    let mut new_segment = segment.clone();
                    new_segment.edge_ids = vec![adjacent_info.edge_id.into()];
                    return_arr.push(Artifact::Segment(new_segment));
                    let mut new_sweep = sweep.clone();
                    new_sweep.edge_ids = vec![adjacent_info.edge_id.into()];
                    return_arr.push(Artifact::Sweep(new_sweep));
                    let mut new_wall = wall.clone();
                    new_wall.edge_cut_edge_ids = vec![adjacent_info.edge_id.into()];
                    return_arr.push(Artifact::Wall(new_wall));
                }
            }
            return Ok(return_arr);
        }
        ModelingCmd::Solid3dFilletEdge(cmd) => {
            let mut return_arr = Vec::new();
            let edge_id = if let Some(edge_id) = cmd.edge_id {
                ArtifactId::new(edge_id)
            } else {
                let Some(edge_id) = cmd.edge_ids.first() else {
                    internal_error!(
                        range,
                        "Solid3dFilletEdge command has no edge ID: id={id:?}, cmd={cmd:?}"
                    );
                };
                edge_id.into()
            };
            return_arr.push(Artifact::EdgeCut(EdgeCut {
                id,
                sub_type: cmd.cut_type.into(),
                consumed_edge_id: edge_id,
                edge_ids: Vec::new(),
                surface_id: None,
                code_ref,
            }));
            let consumed_edge = artifacts.get(&edge_id);
            if let Some(Artifact::Segment(consumed_edge)) = consumed_edge {
                let mut new_segment = consumed_edge.clone();
                new_segment.edge_cut_id = Some(id);
                return_arr.push(Artifact::Segment(new_segment));
            } else {
                // TODO: Handle other types like SweepEdge.
            }
            return Ok(return_arr);
        }
        ModelingCmd::Solid3dCutEdges(cmd) => {
            let mut return_arr = Vec::new();
            let edge_id = if let Some(edge_id) = cmd.edge_ids.first() {
                edge_id.into()
            } else {
                internal_error!(range, "Solid3dCutEdges command has no edge ID: id={id:?}, cmd={cmd:?}");
            };
            return_arr.push(Artifact::EdgeCut(EdgeCut {
                id,
                sub_type: cmd.cut_type.into(),
                consumed_edge_id: edge_id,
                edge_ids: Vec::new(),
                surface_id: None,
                code_ref,
            }));
            let consumed_edge = artifacts.get(&edge_id);
            if let Some(Artifact::Segment(consumed_edge)) = consumed_edge {
                let mut new_segment = consumed_edge.clone();
                new_segment.edge_cut_id = Some(id);
                return_arr.push(Artifact::Segment(new_segment));
            } else {
                // TODO: Handle other types like SweepEdge.
            }
            return Ok(return_arr);
        }
        ModelingCmd::EntityMakeHelix(cmd) => {
            let cylinder_id = ArtifactId::new(cmd.cylinder_id);
            let return_arr = vec![Artifact::Helix(Helix {
                id,
                axis_id: Some(cylinder_id),
                code_ref,
                trajectory_sweep_id: None,
                consumed: false,
            })];
            return Ok(return_arr);
        }
        ModelingCmd::EntityMakeHelixFromParams(_) => {
            let return_arr = vec![Artifact::Helix(Helix {
                id,
                axis_id: None,
                code_ref,
                trajectory_sweep_id: None,
                consumed: false,
            })];
            return Ok(return_arr);
        }
        ModelingCmd::EntityMakeHelixFromEdge(helix) => {
            let edge_id = ArtifactId::new(helix.edge_id);
            let return_arr = vec![Artifact::Helix(Helix {
                id,
                axis_id: Some(edge_id),
                code_ref,
                trajectory_sweep_id: None,
                consumed: false,
            })];
            // We could add the reverse graph edge connecting from the edge to
            // the helix here, but it's not useful right now.
            return Ok(return_arr);
        }
        ModelingCmd::Solid2dAddHole(solid2d_add_hole) => {
            let mut return_arr = Vec::new();
            // Add the hole to the outer.
            let outer_path = artifacts.get(&ArtifactId::new(solid2d_add_hole.object_id));
            if let Some(Artifact::Path(path)) = outer_path {
                let mut new_path = path.clone();
                new_path.inner_path_id = Some(ArtifactId::new(solid2d_add_hole.hole_id));
                return_arr.push(Artifact::Path(new_path));
            }
            // Add the outer to the hole.
            let inner_solid2d = artifacts.get(&ArtifactId::new(solid2d_add_hole.hole_id));
            if let Some(Artifact::Path(path)) = inner_solid2d {
                let mut new_path = path.clone();
                new_path.consumed = true;
                new_path.outer_path_id = Some(ArtifactId::new(solid2d_add_hole.object_id));
                return_arr.push(Artifact::Path(new_path));
            }
            return Ok(return_arr);
        }
        ModelingCmd::BooleanIntersection(_) | ModelingCmd::BooleanSubtract(_) | ModelingCmd::BooleanUnion(_) => {
            let (sub_type, solid_ids, tool_ids) = match cmd {
                ModelingCmd::BooleanIntersection(intersection) => {
                    let solid_ids = intersection
                        .solid_ids
                        .iter()
                        .copied()
                        .map(ArtifactId::new)
                        .collect::<Vec<_>>();
                    (CompositeSolidSubType::Intersect, solid_ids, Vec::new())
                }
                ModelingCmd::BooleanSubtract(subtract) => {
                    let solid_ids = subtract
                        .target_ids
                        .iter()
                        .copied()
                        .map(ArtifactId::new)
                        .collect::<Vec<_>>();
                    let tool_ids = subtract
                        .tool_ids
                        .iter()
                        .copied()
                        .map(ArtifactId::new)
                        .collect::<Vec<_>>();
                    (CompositeSolidSubType::Subtract, solid_ids, tool_ids)
                }
                ModelingCmd::BooleanUnion(union) => {
                    let solid_ids = union.solid_ids.iter().copied().map(ArtifactId::new).collect::<Vec<_>>();
                    (CompositeSolidSubType::Union, solid_ids, Vec::new())
                }
                _ => internal_error!(
                    range,
                    "Boolean or composite command variant not handled: id={id:?}, cmd={cmd:?}"
                ),
            };

            let mut new_solid_ids = vec![id];

            // Make sure we don't ever create a duplicate ID since merge_ids
            // can't handle it.
            let not_cmd_id = move |solid_id: &ArtifactId| *solid_id != id;

            match response {
                Some(OkModelingCmdResponse::BooleanIntersection(intersection)) => intersection
                    .extra_solid_ids
                    .iter()
                    .copied()
                    .map(ArtifactId::new)
                    .filter(not_cmd_id)
                    .for_each(|id| new_solid_ids.push(id)),
                Some(OkModelingCmdResponse::BooleanSubtract(subtract)) => subtract
                    .extra_solid_ids
                    .iter()
                    .copied()
                    .map(ArtifactId::new)
                    .filter(not_cmd_id)
                    .for_each(|id| new_solid_ids.push(id)),
                Some(OkModelingCmdResponse::BooleanUnion(union)) => union
                    .extra_solid_ids
                    .iter()
                    .copied()
                    .map(ArtifactId::new)
                    .filter(not_cmd_id)
                    .for_each(|id| new_solid_ids.push(id)),
                _ => {}
            }

            let mut return_arr = Vec::new();

            // Create the new composite solids and update their linked artifacts
            for solid_id in &new_solid_ids {
                // Create the composite solid
                return_arr.push(Artifact::CompositeSolid(CompositeSolid {
                    id: *solid_id,
                    consumed: false,
                    sub_type,
                    solid_ids: solid_ids.clone(),
                    tool_ids: tool_ids.clone(),
                    code_ref: code_ref.clone(),
                    composite_solid_id: None,
                }));

                // Update the artifacts that were used as input for this composite solid
                for input_id in &solid_ids {
                    if let Some(artifact) = artifacts.get(input_id) {
                        match artifact {
                            Artifact::CompositeSolid(comp) => {
                                let mut new_comp = comp.clone();
                                new_comp.composite_solid_id = Some(*solid_id);
                                new_comp.consumed = true;
                                return_arr.push(Artifact::CompositeSolid(new_comp));
                            }
                            Artifact::Path(path) => {
                                let mut new_path = path.clone();
                                new_path.composite_solid_id = Some(*solid_id);

                                // We want to mark any sweeps of the path used in this operation
                                // as consumed. The path itself is already consumed by sweeping
                                if let Some(sweep_id) = new_path.sweep_id
                                    && let Some(Artifact::Sweep(sweep)) = artifacts.get(&sweep_id)
                                {
                                    let mut new_sweep = sweep.clone();
                                    new_sweep.consumed = true;
                                    return_arr.push(Artifact::Sweep(new_sweep));
                                }

                                return_arr.push(Artifact::Path(new_path));
                            }
                            _ => {}
                        }
                    }
                }

                // Update the tool artifacts if this is a subtract operation
                for tool_id in &tool_ids {
                    if let Some(artifact) = artifacts.get(tool_id) {
                        match artifact {
                            Artifact::CompositeSolid(comp) => {
                                let mut new_comp = comp.clone();
                                new_comp.composite_solid_id = Some(*solid_id);
                                new_comp.consumed = true;
                                return_arr.push(Artifact::CompositeSolid(new_comp));
                            }
                            Artifact::Path(path) => {
                                let mut new_path = path.clone();
                                new_path.composite_solid_id = Some(*solid_id);

                                // We want to mark any sweeps of the path used in this operation
                                // as consumed. The path itself is already consumed by sweeping
                                if let Some(sweep_id) = new_path.sweep_id
                                    && let Some(Artifact::Sweep(sweep)) = artifacts.get(&sweep_id)
                                {
                                    let mut new_sweep = sweep.clone();
                                    new_sweep.consumed = true;
                                    return_arr.push(Artifact::Sweep(new_sweep));
                                }

                                return_arr.push(Artifact::Path(new_path));
                            }
                            _ => {}
                        }
                    }
                }
            }

            return Ok(return_arr);
        }
        _ => {}
    }

    Ok(Vec::new())
}
