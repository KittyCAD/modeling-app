use fnv::FnvHashMap;
use indexmap::IndexMap;
use kittycad_modeling_cmds::{
    self as kcmc,
    id::ModelingCmdId,
    ok_response::OkModelingCmdResponse,
    shared::ExtrusionFaceCapType,
    websocket::{BatchResponse, OkWebSocketResponseData, WebSocketResponse},
    EnableSketchMode, ModelingCmd, SketchModeDisable,
};
use serde::{ser::SerializeSeq, Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    parsing::ast::types::{Node, Program},
    KclError, SourceRange,
};

/// A command that may create or update artifacts on the TS side.  Because
/// engine commands are batched, we don't have the response yet when these are
/// created.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct ArtifactCommand {
    /// Identifier of the command that can be matched with its response.
    pub cmd_id: Uuid,
    pub range: SourceRange,
    /// The engine command.  Each artifact command is backed by an engine
    /// command.  In the future, we may need to send information to the TS side
    /// without an engine command, in which case, we would make this field
    /// optional.
    pub command: ModelingCmd,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
pub struct ArtifactId(Uuid);

impl ArtifactId {
    pub fn new(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl From<Uuid> for ArtifactId {
    fn from(uuid: Uuid) -> Self {
        Self::new(uuid)
    }
}

impl From<&Uuid> for ArtifactId {
    fn from(uuid: &Uuid) -> Self {
        Self::new(*uuid)
    }
}

impl From<ArtifactId> for Uuid {
    fn from(id: ArtifactId) -> Self {
        id.0
    }
}

impl From<&ArtifactId> for Uuid {
    fn from(id: &ArtifactId) -> Self {
        id.0
    }
}

impl From<ModelingCmdId> for ArtifactId {
    fn from(id: ModelingCmdId) -> Self {
        Self::new(*id.as_ref())
    }
}

impl From<&ModelingCmdId> for ArtifactId {
    fn from(id: &ModelingCmdId) -> Self {
        Self::new(*id.as_ref())
    }
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct CodeRef {
    pub range: SourceRange,
    // TODO: We should implement this in Rust.
    #[serde(default, serialize_with = "serialize_dummy_path_to_node")]
    #[ts(type = "Array<[string | number, string]>")]
    pub path_to_node: DummyPathToNode,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Plane {
    pub id: ArtifactId,
    pub path_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Path {
    pub id: ArtifactId,
    pub plane_id: ArtifactId,
    pub seg_ids: Vec<ArtifactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sweep_id: Option<ArtifactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solid2d_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: ArtifactId,
    pub path_id: ArtifactId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<ArtifactId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_ids: Vec<ArtifactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_cut_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
}

/// A sweep is a more generic term for extrude, revolve, loft, and sweep.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Sweep {
    pub id: ArtifactId,
    pub sub_type: SweepSubType,
    pub path_id: ArtifactId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub surface_ids: Vec<ArtifactId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_ids: Vec<ArtifactId>,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum SweepSubType {
    Extrusion,
    Revolve,
    Loft,
    Sweep,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Solid2d {
    pub id: ArtifactId,
    pub path_id: ArtifactId,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Wall {
    pub id: ArtifactId,
    pub seg_id: ArtifactId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cut_edge_ids: Vec<ArtifactId>,
    pub sweep_id: ArtifactId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub path_ids: Vec<ArtifactId>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct Cap {
    pub id: ArtifactId,
    pub sub_type: CapSubType,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cut_edge_ids: Vec<ArtifactId>,
    pub sweep_id: ArtifactId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub path_ids: Vec<ArtifactId>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum CapSubType {
    Start,
    End,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct SweepEdge {
    pub id: ArtifactId,
    pub sub_type: SweepEdgeSubType,
    pub seg_id: ArtifactId,
    pub sweep_id: ArtifactId,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum SweepEdgeSubType {
    Opposite,
    Adjacent,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct EdgeCut {
    pub id: ArtifactId,
    pub sub_type: EdgeCutSubType,
    pub consumed_edge_id: ArtifactId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_ids: Vec<ArtifactId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub enum EdgeCutSubType {
    Fillet,
    Chamfer,
}

impl From<kcmc::shared::CutType> for EdgeCutSubType {
    fn from(cut_type: kcmc::shared::CutType) -> Self {
        match cut_type {
            kcmc::shared::CutType::Fillet => EdgeCutSubType::Fillet,
            kcmc::shared::CutType::Chamfer => EdgeCutSubType::Chamfer,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct EdgeCutEdge {
    pub id: ArtifactId,
    pub edge_cut_id: ArtifactId,
    pub surface_id: ArtifactId,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Artifact {
    Plane(Plane),
    Path(Path),
    Segment(Segment),
    Solid2d(Solid2d),
    #[serde(rename_all = "camelCase")]
    StartSketchOnFace {
        id: ArtifactId,
        face_id: Uuid,
        source_range: SourceRange,
    },
    #[serde(rename_all = "camelCase")]
    StartSketchOnPlane {
        id: ArtifactId,
        plane_id: Uuid,
        source_range: SourceRange,
    },
    Sweep(Sweep),
    Wall(Wall),
    Cap(Cap),
    SweepEdge(SweepEdge),
    EdgeCut(EdgeCut),
    EdgeCutEdge(EdgeCutEdge),
}

impl Artifact {
    pub(crate) fn id(&self) -> ArtifactId {
        match self {
            Artifact::Plane(a) => a.id,
            Artifact::Path(a) => a.id,
            Artifact::Segment(a) => a.id,
            Artifact::Solid2d(a) => a.id,
            Artifact::StartSketchOnFace { id, .. } => *id,
            Artifact::StartSketchOnPlane { id, .. } => *id,
            Artifact::Sweep(a) => a.id,
            Artifact::Wall(a) => a.id,
            Artifact::Cap(a) => a.id,
            Artifact::SweepEdge(a) => a.id,
            Artifact::EdgeCut(a) => a.id,
            Artifact::EdgeCutEdge(a) => a.id,
        }
    }

    #[expect(dead_code)]
    pub(crate) fn code_ref(&self) -> Option<&CodeRef> {
        match self {
            Artifact::Plane(a) => Some(&a.code_ref),
            Artifact::Path(a) => Some(&a.code_ref),
            Artifact::Segment(a) => Some(&a.code_ref),
            Artifact::Solid2d(_) => None,
            // TODO: We should add code refs for these.
            Artifact::StartSketchOnFace { .. } => None,
            Artifact::StartSketchOnPlane { .. } => None,
            Artifact::Sweep(a) => Some(&a.code_ref),
            Artifact::Wall(_) => None,
            Artifact::Cap(_) => None,
            Artifact::SweepEdge(_) => None,
            Artifact::EdgeCut(a) => Some(&a.code_ref),
            Artifact::EdgeCutEdge(_) => None,
        }
    }

    /// The IDs pointing back to prior nodes in a depth-first traversal of
    /// the graph.  This should be disjoint with `child_ids`.
    #[cfg(test)]
    pub(crate) fn back_edges(&self) -> Vec<ArtifactId> {
        match self {
            Artifact::Plane(_) => Vec::new(),
            Artifact::Path(a) => vec![a.plane_id],
            Artifact::Segment(a) => vec![a.path_id],
            Artifact::Solid2d(a) => vec![a.path_id],
            Artifact::StartSketchOnFace { face_id, .. } => vec![face_id.into()],
            Artifact::StartSketchOnPlane { plane_id, .. } => vec![plane_id.into()],
            Artifact::Sweep(a) => vec![a.path_id],
            Artifact::Wall(a) => vec![a.seg_id, a.sweep_id],
            Artifact::Cap(a) => vec![a.sweep_id],
            Artifact::SweepEdge(a) => vec![a.seg_id, a.sweep_id],
            Artifact::EdgeCut(a) => vec![a.consumed_edge_id],
            Artifact::EdgeCutEdge(a) => vec![a.edge_cut_id],
        }
    }

    /// The child IDs of this artifact, used to do a depth-first traversal of
    /// the graph.
    #[cfg(test)]
    pub(crate) fn child_ids(&self) -> Vec<ArtifactId> {
        match self {
            Artifact::Plane(a) => a.path_ids.clone(),
            Artifact::Path(a) => {
                // Note: Don't include these since they're parents: plane_id.
                let mut ids = a.seg_ids.clone();
                if let Some(sweep_id) = a.sweep_id {
                    ids.push(sweep_id);
                }
                if let Some(solid2d_id) = a.solid2d_id {
                    ids.push(solid2d_id);
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
                ids
            }
            Artifact::Solid2d(_) => {
                // Note: Don't include these since they're parents: path_id.
                Vec::new()
            }
            Artifact::StartSketchOnFace { .. } => Vec::new(),
            Artifact::StartSketchOnPlane { .. } => Vec::new(),
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
            Artifact::SweepEdge(_) => {
                // Note: Don't include these since they're parents: seg_id,
                // sweep_id.
                Vec::new()
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
        }
    }

    /// Merge the new artifact into self.  If it can't because it's a different
    /// type, return the new artifact which should be used as a replacement.
    fn merge(&mut self, new: Artifact) -> Option<Artifact> {
        match self {
            Artifact::Plane(a) => a.merge(new),
            Artifact::Path(a) => a.merge(new),
            Artifact::Segment(a) => a.merge(new),
            Artifact::Solid2d(_) => Some(new),
            Artifact::StartSketchOnFace { .. } => Some(new),
            Artifact::StartSketchOnPlane { .. } => Some(new),
            Artifact::Sweep(a) => a.merge(new),
            Artifact::Wall(a) => a.merge(new),
            Artifact::Cap(a) => a.merge(new),
            Artifact::SweepEdge(_) => Some(new),
            Artifact::EdgeCut(a) => a.merge(new),
            Artifact::EdgeCutEdge(_) => Some(new),
        }
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
        merge_ids(&mut self.seg_ids, new.seg_ids);
        merge_opt_id(&mut self.solid2d_id, new.solid2d_id);

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

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct ArtifactGraph {
    map: IndexMap<ArtifactId, Artifact>,
}

pub(crate) fn build_artifact_graph(
    artifact_commands: &[ArtifactCommand],
    responses: &IndexMap<Uuid, WebSocketResponse>,
    ast: &Node<Program>,
    exec_artifacts: &IndexMap<ArtifactId, Artifact>,
) -> Result<ArtifactGraph, KclError> {
    let mut map = IndexMap::new();

    let mut current_plane_id = None;

    for artifact_command in artifact_commands {
        if let ModelingCmd::EnableSketchMode(EnableSketchMode { entity_id, .. }) = artifact_command.command {
            current_plane_id = Some(entity_id);
        }
        if let ModelingCmd::SketchModeDisable(SketchModeDisable { .. }) = artifact_command.command {
            current_plane_id = None;
        }

        let flattened_responses = flatten_modeling_command_responses(responses);
        let artifact_updates = artifacts_to_update(
            &map,
            artifact_command,
            &flattened_responses,
            current_plane_id,
            ast,
            exec_artifacts,
        )?;
        for artifact in artifact_updates {
            // Merge with existing artifacts.
            merge_artifact_into_map(&mut map, artifact);
        }
    }

    Ok(ArtifactGraph { map })
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

fn merge_opt_id(base: &mut Option<ArtifactId>, new: Option<ArtifactId>) {
    if let Some(new) = new {
        *base = Some(new);
    }
}

fn artifacts_to_update(
    artifacts: &IndexMap<ArtifactId, Artifact>,
    artifact_command: &ArtifactCommand,
    responses: &FnvHashMap<Uuid, OkModelingCmdResponse>,
    current_plane_id: Option<Uuid>,
    _ast: &Node<Program>,
    _exec_artifacts: &IndexMap<ArtifactId, Artifact>,
) -> Result<Vec<Artifact>, KclError> {
    // TODO: Build path-to-node from artifact_command source range.  Right now,
    // we're serializing an empty array, and the TS wrapper fills it in with the
    // correct value.
    let path_to_node = Vec::new();

    let range = artifact_command.range;
    let uuid = artifact_command.cmd_id;
    let id = ArtifactId::new(uuid);

    let Some(response) = responses.get(&uuid) else {
        // Response not found or not successful.
        return Ok(Vec::new());
    };

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
                code_ref: CodeRef { range, path_to_node },
            })]);
        }
        ModelingCmd::EnableSketchMode(_) => {
            let current_plane_id = current_plane_id.ok_or_else(|| {
                KclError::internal(format!(
                    "Expected a current plane ID when processing EnableSketchMode command, but we have none: {id:?}"
                ))
            })?;
            let existing_plane = artifacts.get(&ArtifactId::new(current_plane_id));
            match existing_plane {
                Some(Artifact::Wall(wall)) => {
                    return Ok(vec![Artifact::Wall(Wall {
                        id: current_plane_id.into(),
                        seg_id: wall.seg_id,
                        edge_cut_edge_ids: wall.edge_cut_edge_ids.clone(),
                        sweep_id: wall.sweep_id,
                        path_ids: wall.path_ids.clone(),
                    })]);
                }
                Some(_) | None => {
                    let path_ids = match existing_plane {
                        Some(Artifact::Plane(Plane { path_ids, .. })) => path_ids.clone(),
                        _ => Vec::new(),
                    };
                    return Ok(vec![Artifact::Plane(Plane {
                        id: current_plane_id.into(),
                        path_ids,
                        code_ref: CodeRef { range, path_to_node },
                    })]);
                }
            }
        }
        ModelingCmd::StartPath(_) => {
            let mut return_arr = Vec::new();
            let current_plane_id = current_plane_id.ok_or_else(|| {
                KclError::internal(format!(
                    "Expected a current plane ID when processing StartPath command, but we have none: {id:?}"
                ))
            })?;
            return_arr.push(Artifact::Path(Path {
                id,
                plane_id: current_plane_id.into(),
                seg_ids: Vec::new(),
                sweep_id: None,
                solid2d_id: None,
                code_ref: CodeRef { range, path_to_node },
            }));
            let plane = artifacts.get(&ArtifactId::new(current_plane_id));
            if let Some(Artifact::Plane(plane)) = plane {
                let code_ref = plane.code_ref.clone();
                return_arr.push(Artifact::Plane(Plane {
                    id: current_plane_id.into(),
                    path_ids: vec![id],
                    code_ref,
                }));
            }
            if let Some(Artifact::Wall(wall)) = plane {
                return_arr.push(Artifact::Wall(Wall {
                    id: current_plane_id.into(),
                    seg_id: wall.seg_id,
                    edge_cut_edge_ids: wall.edge_cut_edge_ids.clone(),
                    sweep_id: wall.sweep_id,
                    path_ids: vec![id],
                }));
            }
            return Ok(return_arr);
        }
        ModelingCmd::ClosePath(_) | ModelingCmd::ExtendPath(_) => {
            let path_id = ArtifactId::new(match cmd {
                ModelingCmd::ClosePath(c) => c.path_id,
                ModelingCmd::ExtendPath(e) => e.path.into(),
                _ => unreachable!(),
            });
            let mut return_arr = Vec::new();
            return_arr.push(Artifact::Segment(Segment {
                id,
                path_id,
                surface_id: None,
                edge_ids: Vec::new(),
                edge_cut_id: None,
                code_ref: CodeRef { range, path_to_node },
            }));
            let path = artifacts.get(&path_id);
            if let Some(Artifact::Path(path)) = path {
                let mut new_path = path.clone();
                new_path.seg_ids = vec![id];
                return_arr.push(Artifact::Path(new_path));
            }
            if let OkModelingCmdResponse::ClosePath(close_path) = response {
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
        ModelingCmd::Extrude(kcmc::Extrude { target, .. })
        | ModelingCmd::Revolve(kcmc::Revolve { target, .. })
        | ModelingCmd::Sweep(kcmc::Sweep { target, .. }) => {
            let sub_type = match cmd {
                ModelingCmd::Extrude(_) => SweepSubType::Extrusion,
                ModelingCmd::Revolve(_) => SweepSubType::Revolve,
                ModelingCmd::Sweep(_) => SweepSubType::Sweep,
                _ => unreachable!(),
            };
            let mut return_arr = Vec::new();
            let target = ArtifactId::from(target);
            return_arr.push(Artifact::Sweep(Sweep {
                id,
                sub_type,
                path_id: target,
                surface_ids: Vec::new(),
                edge_ids: Vec::new(),
                code_ref: CodeRef { range, path_to_node },
            }));
            let path = artifacts.get(&target);
            if let Some(Artifact::Path(path)) = path {
                let mut new_path = path.clone();
                new_path.sweep_id = Some(id);
                return_arr.push(Artifact::Path(new_path));
            }
            return Ok(return_arr);
        }
        ModelingCmd::Loft(loft_cmd) => {
            let OkModelingCmdResponse::Loft(_) = response else {
                return Ok(Vec::new());
            };
            let mut return_arr = Vec::new();
            return_arr.push(Artifact::Sweep(Sweep {
                id,
                sub_type: SweepSubType::Loft,
                // TODO: Using the first one.  Make sure to revisit this
                // choice, don't think it matters for now.
                path_id: ArtifactId::new(*loft_cmd.section_ids.first().ok_or_else(|| {
                    KclError::internal(format!(
                        "Expected at least one section ID in Loft command: {id:?}; cmd={cmd:?}"
                    ))
                })?),
                surface_ids: Vec::new(),
                edge_ids: Vec::new(),
                code_ref: CodeRef { range, path_to_node },
            }));
            for section_id in &loft_cmd.section_ids {
                let path = artifacts.get(&ArtifactId::new(*section_id));
                if let Some(Artifact::Path(path)) = path {
                    let mut new_path = path.clone();
                    new_path.id = id;
                    return_arr.push(Artifact::Path(new_path));
                }
            }
            return Ok(return_arr);
        }
        ModelingCmd::Solid3dGetExtrusionFaceInfo(_) => {
            let OkModelingCmdResponse::Solid3dGetExtrusionFaceInfo(face_info) = response else {
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
                let path_sweep_id = path.sweep_id.ok_or_else(|| {
                    KclError::internal(format!(
                        "Expected a sweep ID on the path when processing Solid3dGetExtrusionFaceInfo command, but we have none: {id:?}, {path:?}"
                    ))
                })?;
                return_arr.push(Artifact::Wall(Wall {
                    id: face_id,
                    seg_id: curve_id,
                    edge_cut_edge_ids: Vec::new(),
                    sweep_id: path_sweep_id,
                    path_ids: vec![],
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
                    let path_sweep_id = path.sweep_id.ok_or_else(|| {
                        KclError::internal(format!(
                            "Expected a sweep ID on the path when processing Solid3dGetExtrusionFaceInfo command, but we have none: {id:?}, {path:?}"
                        ))
                    })?;
                    return_arr.push(Artifact::Cap(Cap {
                        id: face_id,
                        sub_type,
                        edge_cut_edge_ids: Vec::new(),
                        sweep_id: path_sweep_id,
                        path_ids: Vec::new(),
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
        ModelingCmd::Solid3dGetNextAdjacentEdge(kcmc::Solid3dGetNextAdjacentEdge { face_id, edge_id, .. })
        | ModelingCmd::Solid3dGetOppositeEdge(kcmc::Solid3dGetOppositeEdge { face_id, edge_id, .. }) => {
            let sub_type = match cmd {
                ModelingCmd::Solid3dGetNextAdjacentEdge(_) => SweepEdgeSubType::Adjacent,
                ModelingCmd::Solid3dGetOppositeEdge(_) => SweepEdgeSubType::Opposite,
                _ => unreachable!(),
            };
            let face_id = ArtifactId::new(*face_id);
            let edge_id = ArtifactId::new(*edge_id);
            let Some(Artifact::Wall(wall)) = artifacts.get(&face_id) else {
                return Ok(Vec::new());
            };
            let Some(Artifact::Sweep(sweep)) = artifacts.get(&wall.sweep_id) else {
                return Ok(Vec::new());
            };
            let Some(Artifact::Path(_)) = artifacts.get(&sweep.path_id) else {
                return Ok(Vec::new());
            };
            let Some(Artifact::Segment(segment)) = artifacts.get(&edge_id) else {
                return Ok(Vec::new());
            };
            let response_edge_id = match response {
                OkModelingCmdResponse::Solid3dGetNextAdjacentEdge(r) => {
                    let Some(edge_id) = r.edge else {
                        return Err(KclError::internal(format!(
                            "Expected Solid3dGetNextAdjacentEdge response to have an edge ID, but found none: {response:?}"
                        )));
                    };
                    edge_id.into()
                }
                OkModelingCmdResponse::Solid3dGetOppositeEdge(r) => r.edge.into(),
                _ => {
                    return Err(KclError::internal(format!(
                        "Expected Solid3dGetNextAdjacentEdge or Solid3dGetOppositeEdge response, but got: {response:?}"
                    )));
                }
            };

            let mut return_arr = Vec::new();
            return_arr.push(Artifact::SweepEdge(SweepEdge {
                id: response_edge_id,
                sub_type,
                seg_id: edge_id,
                sweep_id: sweep.id,
            }));
            let mut new_segment = segment.clone();
            new_segment.edge_ids = vec![response_edge_id];
            return_arr.push(Artifact::Segment(new_segment));
            let mut new_sweep = sweep.clone();
            new_sweep.edge_ids = vec![response_edge_id];
            return_arr.push(Artifact::Sweep(new_sweep));
            return Ok(return_arr);
        }
        ModelingCmd::Solid3dFilletEdge(cmd) => {
            let mut return_arr = Vec::new();
            return_arr.push(Artifact::EdgeCut(EdgeCut {
                id,
                sub_type: cmd.cut_type.into(),
                consumed_edge_id: cmd.edge_id.into(),
                edge_ids: Vec::new(),
                surface_id: None,
                code_ref: CodeRef { range, path_to_node },
            }));
            let consumed_edge = artifacts.get(&ArtifactId::new(cmd.edge_id));
            if let Some(Artifact::Segment(consumed_edge)) = consumed_edge {
                let mut new_segment = consumed_edge.clone();
                new_segment.edge_cut_id = Some(id);
                return_arr.push(Artifact::Segment(new_segment));
            }
            return Ok(return_arr);
        }
        _ => {}
    }

    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use std::fmt::Write;

    use super::*;

    type NodeId = u32;

    type Edges = IndexMap<(NodeId, NodeId), EdgeInfo>;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct EdgeInfo {
        direction: EdgeDirection,
        kind: EdgeKind,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    enum EdgeDirection {
        Forward,
        Backward,
        Bidirectional,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    enum EdgeKind {
        PathToSweep,
        Other,
    }

    impl EdgeDirection {
        #[must_use]
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

    impl ArtifactGraph {
        /// Output the Mermaid flowchart for the artifact graph.
        pub(crate) fn to_mermaid_flowchart(&self) -> Result<String, std::fmt::Error> {
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
            self.flowchart_nodes(&mut output, &stable_id_map, "  ")?;
            self.flowchart_edges(&mut output, &stable_id_map, "  ")?;

            output.push_str("```\n");

            Ok(output)
        }

        /// Output the Mermaid flowchart nodes, one for each artifact.
        fn flowchart_nodes<W: Write>(
            &self,
            output: &mut W,
            stable_id_map: &FnvHashMap<ArtifactId, NodeId>,
            prefix: &str,
        ) -> std::fmt::Result {
            // Artifact ID of the path is the key.  The value is a list of
            // artifact IDs in that group.
            let mut groups = IndexMap::new();
            let mut ungrouped = Vec::new();

            for artifact in self.map.values() {
                let id = artifact.id();

                let grouped = match artifact {
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
                    | Artifact::Sweep(_)
                    | Artifact::Wall(_)
                    | Artifact::Cap(_)
                    | Artifact::SweepEdge(_)
                    | Artifact::EdgeCut(_)
                    | Artifact::EdgeCutEdge(_) => false,
                };
                if !grouped {
                    ungrouped.push(id);
                }
            }

            for (group_id, artifact_ids) in groups {
                let group_id = *stable_id_map.get(&group_id).unwrap();
                writeln!(output, "{prefix}subgraph path{group_id} [Path]")?;
                let indented = format!("{}  ", prefix);
                for artifact_id in artifact_ids {
                    let artifact = self.map.get(&artifact_id).unwrap();
                    let id = *stable_id_map.get(&artifact_id).unwrap();
                    self.flowchart_node(output, artifact, id, &indented)?;
                }
                writeln!(output, "{prefix}end")?;
            }

            for artifact_id in ungrouped {
                let artifact = self.map.get(&artifact_id).unwrap();
                let id = *stable_id_map.get(&artifact_id).unwrap();
                self.flowchart_node(output, artifact, id, prefix)?;
            }

            Ok(())
        }

        fn flowchart_node<W: Write>(
            &self,
            output: &mut W,
            artifact: &Artifact,
            id: NodeId,
            prefix: &str,
        ) -> std::fmt::Result {
            // For now, only showing the source range.
            fn code_ref_display(code_ref: &CodeRef) -> [usize; 3] {
                range_display(code_ref.range)
            }
            fn range_display(range: SourceRange) -> [usize; 3] {
                [range.start(), range.end(), range.module_id().as_usize()]
            }

            match artifact {
                Artifact::Plane(plane) => {
                    writeln!(
                        output,
                        "{prefix}{}[\"Plane<br>{:?}\"]",
                        id,
                        code_ref_display(&plane.code_ref)
                    )?;
                }
                Artifact::Path(path) => {
                    writeln!(
                        output,
                        "{prefix}{}[\"Path<br>{:?}\"]",
                        id,
                        code_ref_display(&path.code_ref)
                    )?;
                }
                Artifact::Segment(segment) => {
                    writeln!(
                        output,
                        "{prefix}{}[\"Segment<br>{:?}\"]",
                        id,
                        code_ref_display(&segment.code_ref)
                    )?;
                }
                Artifact::Solid2d(_solid2d) => {
                    writeln!(output, "{prefix}{}[Solid2d]", id)?;
                }
                Artifact::StartSketchOnFace { source_range, .. } => {
                    writeln!(
                        output,
                        "{prefix}{}[\"StartSketchOnFace<br>{:?}\"]",
                        id,
                        range_display(*source_range)
                    )?;
                }
                Artifact::StartSketchOnPlane { source_range, .. } => {
                    writeln!(
                        output,
                        "{prefix}{}[\"StartSketchOnPlane<br>{:?}\"]",
                        id,
                        range_display(*source_range)
                    )?;
                }
                Artifact::Sweep(sweep) => {
                    writeln!(
                        output,
                        "{prefix}{}[\"Sweep {:?}<br>{:?}\"]",
                        id,
                        sweep.sub_type,
                        code_ref_display(&sweep.code_ref)
                    )?;
                }
                Artifact::Wall(_wall) => {
                    writeln!(output, "{prefix}{}[Wall]", id)?;
                }
                Artifact::Cap(cap) => {
                    writeln!(output, "{prefix}{}[\"Cap {:?}\"]", id, cap.sub_type)?;
                }
                Artifact::SweepEdge(sweep_edge) => {
                    writeln!(output, "{prefix}{}[\"SweepEdge {:?}\"]", id, sweep_edge.sub_type)?;
                }
                Artifact::EdgeCut(edge_cut) => {
                    writeln!(
                        output,
                        "{prefix}{}[\"EdgeCut {:?}<br>{:?}\"]",
                        id,
                        edge_cut.sub_type,
                        code_ref_display(&edge_cut.code_ref)
                    )?;
                }
                Artifact::EdgeCutEdge(_edge_cut_edge) => {
                    writeln!(output, "{prefix}{}[EdgeCutEdge]", id)?;
                }
            }
            Ok(())
        }

        fn flowchart_edges<W: Write>(
            &self,
            output: &mut W,
            stable_id_map: &FnvHashMap<ArtifactId, NodeId>,
            prefix: &str,
        ) -> Result<(), std::fmt::Error> {
            // Mermaid will display two edges in either direction, even using
            // the `---` edge type. So we need to deduplicate them.
            fn add_unique_edge(edges: &mut Edges, source_id: NodeId, target_id: NodeId, kind: EdgeKind) {
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
                let edge = edges.entry((a, b)).or_insert(EdgeInfo {
                    direction: new_direction,
                    kind,
                });
                // Merge with existing edge.
                edge.direction = edge.direction.merge(new_direction);
            }

            // Collect all edges to deduplicate them.
            let mut edges = IndexMap::default();
            for artifact in self.map.values() {
                let source_id = *stable_id_map.get(&artifact.id()).unwrap();
                for target_id in artifact.back_edges().into_iter().chain(artifact.child_ids()) {
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
                    add_unique_edge(&mut edges, source_id, target_id, edge_kind);
                }
            }

            // Output the edges.
            for ((source_id, target_id), edge) in edges {
                let extra = match edge.kind {
                    // Extra length.
                    EdgeKind::PathToSweep => "-",
                    EdgeKind::Other => "",
                };
                match edge.direction {
                    EdgeDirection::Forward => {
                        writeln!(output, "{prefix}{source_id} x{}--> {}", extra, target_id)?;
                    }
                    EdgeDirection::Backward => {
                        writeln!(output, "{prefix}{target_id} x{}--> {}", extra, source_id)?;
                    }
                    EdgeDirection::Bidirectional => {
                        writeln!(output, "{prefix}{source_id} {}--- {}", extra, target_id)?;
                    }
                }
            }

            Ok(())
        }

        /// Output the Mermaid mind map for the artifact graph.
        ///
        /// This is sometimes easier to read than the flowchart.  But since it
        /// does a depth-first traversal starting from all the planes, it may
        /// not include all the artifacts.  It also doesn't show edge direction.
        /// It's useful for a high-level overview of the graph, not for
        /// including all the information.
        pub(crate) fn to_mermaid_mind_map(&self) -> Result<String, std::fmt::Error> {
            let mut output = String::new();
            output.push_str("```mermaid\n");
            output.push_str("mindmap\n");
            output.push_str("  root\n");

            for (_, artifact) in &self.map {
                // Only the planes are roots.
                let Artifact::Plane(_) = artifact else {
                    continue;
                };
                self.mind_map_artifact(&mut output, artifact, "    ")?;
            }

            output.push_str("```\n");

            Ok(output)
        }

        fn mind_map_artifact<W: Write>(&self, output: &mut W, artifact: &Artifact, prefix: &str) -> std::fmt::Result {
            match artifact {
                Artifact::Plane(_plane) => {
                    writeln!(output, "{prefix}Plane")?;
                }
                Artifact::Path(_path) => {
                    writeln!(output, "{prefix}Path")?;
                }
                Artifact::Segment(_segment) => {
                    writeln!(output, "{prefix}Segment")?;
                }
                Artifact::Solid2d(_solid2d) => {
                    writeln!(output, "{prefix}Solid2d")?;
                }
                Artifact::StartSketchOnFace { .. } => {
                    writeln!(output, "{prefix}StartSketchOnFace")?;
                }
                Artifact::StartSketchOnPlane { .. } => {
                    writeln!(output, "{prefix}StartSketchOnPlane")?;
                }
                Artifact::Sweep(sweep) => {
                    writeln!(output, "{prefix}Sweep {:?}", sweep.sub_type)?;
                }
                Artifact::Wall(_wall) => {
                    writeln!(output, "{prefix}Wall")?;
                }
                Artifact::Cap(cap) => {
                    writeln!(output, "{prefix}Cap {:?}", cap.sub_type)?;
                }
                Artifact::SweepEdge(sweep_edge) => {
                    writeln!(output, "{prefix}SweepEdge {:?}", sweep_edge.sub_type,)?;
                }
                Artifact::EdgeCut(edge_cut) => {
                    writeln!(output, "{prefix}EdgeCut {:?}", edge_cut.sub_type)?;
                }
                Artifact::EdgeCutEdge(_edge_cut_edge) => {
                    writeln!(output, "{prefix}EdgeCutEdge")?;
                }
            }

            for child_id in artifact.child_ids() {
                let Some(child_artifact) = self.map.get(&child_id) else {
                    continue;
                };
                self.mind_map_artifact(output, child_artifact, &format!("{}  ", prefix))?;
            }

            Ok(())
        }
    }
}
