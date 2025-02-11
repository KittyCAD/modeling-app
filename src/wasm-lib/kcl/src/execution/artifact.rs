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
use schemars::JsonSchema;
use serde::{ser::SerializeSeq, Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::KclErrorDetails,
    parsing::ast::types::{Node, Program},
    KclError, SourceRange,
};

#[cfg(test)]
mod mermaid_tests;

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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash, ts_rs::TS, JsonSchema)]
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
#[serde(rename_all = "camelCase")]
pub struct Helix {
    pub id: ArtifactId,
    /// The axis of the helix.  Currently this is always an edge ID, but we may
    /// add axes to the graph.
    pub axis_id: Option<ArtifactId>,
    pub code_ref: CodeRef,
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
    Helix(Helix),
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
            Artifact::Helix(a) => a.id,
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
            Artifact::Helix(a) => Some(&a.code_ref),
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
            Artifact::Helix(_) => Some(new),
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

impl ArtifactGraph {
    pub fn len(&self) -> usize {
        self.map.len()
    }
}

pub(super) fn build_artifact_graph(
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
    // Always use the new one, even if it clears it.
    *base = new;
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
                KclError::Internal(KclErrorDetails {
                    message: format!(
                        "Expected a current plane ID when processing EnableSketchMode command, but we have none: {id:?}"
                    ),
                    source_ranges: vec![range],
                })
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
                KclError::Internal(KclErrorDetails {
                    message: format!(
                        "Expected a current plane ID when processing StartPath command, but we have none: {id:?}"
                    ),
                    source_ranges: vec![range],
                })
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
                    KclError::Internal(KclErrorDetails {
                        message: format!("Expected at least one section ID in Loft command: {id:?}; cmd={cmd:?}"),
                        source_ranges: vec![range],
                    })
                })?),
                surface_ids: Vec::new(),
                edge_ids: Vec::new(),
                code_ref: CodeRef { range, path_to_node },
            }));
            for section_id in &loft_cmd.section_ids {
                let path = artifacts.get(&ArtifactId::new(*section_id));
                if let Some(Artifact::Path(path)) = path {
                    let mut new_path = path.clone();
                    new_path.sweep_id = Some(id);
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
                    KclError::Internal(KclErrorDetails {
                        message:format!(
                            "Expected a sweep ID on the path when processing Solid3dGetExtrusionFaceInfo command, but we have none: {id:?}, {path:?}"
                        ),
                        source_ranges: vec![range],
                    })
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
                        KclError::Internal(KclErrorDetails {
                            message:format!(
                                "Expected a sweep ID on the path when processing Solid3dGetExtrusionFaceInfo command, but we have none: {id:?}, {path:?}"
                            ),
                            source_ranges: vec![range],
                        })
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
                        return Err(KclError::Internal(KclErrorDetails {
                            message:format!(
                                "Expected Solid3dGetNextAdjacentEdge response to have an edge ID, but found none: id={id:?}, {response:?}"
                            ),
                            source_ranges: vec![range],
                        }));
                    };
                    edge_id.into()
                }
                OkModelingCmdResponse::Solid3dGetOppositeEdge(r) => r.edge.into(),
                _ => {
                    return Err(KclError::Internal(KclErrorDetails {
                        message:format!(
                            "Expected Solid3dGetNextAdjacentEdge or Solid3dGetOppositeEdge response, but got: id={id:?}, {response:?}"
                        ),
                        source_ranges: vec![range],
                    }));
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
            } else {
                // TODO: Handle other types like SweepEdge.
            }
            return Ok(return_arr);
        }
        ModelingCmd::EntityMakeHelixFromParams(_) => {
            let return_arr = vec![Artifact::Helix(Helix {
                id,
                axis_id: None,
                code_ref: CodeRef { range, path_to_node },
            })];
            return Ok(return_arr);
        }
        ModelingCmd::EntityMakeHelixFromEdge(helix) => {
            let edge_id = ArtifactId::new(helix.edge_id);
            let return_arr = vec![Artifact::Helix(Helix {
                id,
                axis_id: Some(edge_id),
                code_ref: CodeRef { range, path_to_node },
            })];
            // We could add the reverse graph edge connecting from the edge to
            // the helix here, but it's not useful right now.
            return Ok(return_arr);
        }
        _ => {}
    }

    Ok(Vec::new())
}
