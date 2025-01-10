use fnv::FnvHashMap;
use indexmap::IndexMap;
use kittycad_modeling_cmds::{
    id::ModelingCmdId,
    ok_response::OkModelingCmdResponse,
    shared::ExtrusionFaceCapType,
    websocket::{BatchResponse, OkWebSocketResponseData, WebSocketResponse},
    EnableSketchMode, ModelingCmd, SketchModeDisable,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    parsing::ast::types::{Node, Program},
    KclError, SourceRange,
};

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct ArtifactGraph {
    map: IndexMap<ArtifactId, Artifact>,
}

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

    /// Create a fake placeholder artifact ID.  This is terrible because it's
    /// essentially side-stepping the type system.  But I wanted to faithfully
    /// reproduce the TS behavior.
    pub fn fake_placeholder() -> Self {
        Self(Uuid::nil())
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash, ts_rs::TS)]
#[ts(export_to = "Artifact.ts")]
#[serde(rename_all = "camelCase")]
pub struct CodeRef {
    pub range: SourceRange,
    // TODO
    // pub path_to_node: PathToNode,
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
    pub sweep_id: ArtifactId,
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
    pub surface_id: ArtifactId,
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
    pub edge_cut_ids: Vec<ArtifactId>,
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
    pub edge_cut_ids: Vec<ArtifactId>,
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
#[serde(tag = "type")]
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
        }
    }
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
/// responses.  The raw responses from the engine contains batches.
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
            OkWebSocketResponseData::ModelingBatch { responses } => {
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

    merge_artifact(old_artifact, new_artifact);
}

/// Merge the new artifact into the existing one, mutating it.  If it can't be
/// merged because it's a different type, return the new artifact which should
/// be used as a replacement.
fn merge_artifact(base: &mut Artifact, new: Artifact) {
    match (base, new) {
        (Artifact::Plane(old), Artifact::Plane(new)) => {
            merge_ids(&mut old.path_ids, new.path_ids);
        }
        (Artifact::Path(old), Artifact::Path(new)) => {
            merge_ids(&mut old.seg_ids, new.seg_ids);
            merge_opt_ids(&mut old.solid2d_id, new.solid2d_id);
        }
        (Artifact::Segment(old), Artifact::Segment(new)) => {
            // We initialize this with a placeholder.
            if old.surface_id != new.surface_id {
                old.surface_id = new.surface_id;
            }
            merge_ids(&mut old.edge_ids, new.edge_ids);
            merge_opt_ids(&mut old.edge_cut_id, new.edge_cut_id);
        }
        (Artifact::Sweep(old), Artifact::Sweep(new)) => {
            merge_ids(&mut old.surface_ids, new.surface_ids);
            merge_ids(&mut old.edge_ids, new.edge_ids);
        }
        (Artifact::Wall(old), Artifact::Wall(new)) => {
            merge_ids(&mut old.edge_cut_ids, new.edge_cut_ids);
            merge_ids(&mut old.path_ids, new.path_ids);
        }
        (base, new) => {
            // They're different types.  So replace the old one with the new
            // one.
            *base = new;
        }
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

fn merge_opt_ids(base: &mut Option<ArtifactId>, new: Option<ArtifactId>) {
    *base = base.or(new);
}

fn artifacts_to_update(
    artifacts: &IndexMap<ArtifactId, Artifact>,
    artifact_command: &ArtifactCommand,
    responses: &FnvHashMap<Uuid, OkModelingCmdResponse>,
    current_plane_id: Option<Uuid>,
    _ast: &Node<Program>,
    _exec_artifacts: &IndexMap<ArtifactId, Artifact>,
) -> Result<Vec<Artifact>, KclError> {
    // TODO: Build path-to-node from artifact_command source range.

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
                code_ref: CodeRef { range },
            })]);
        }
        ModelingCmd::EnableSketchMode(_) => {
            let current_plane_id = current_plane_id.ok_or_else(|| {
                KclError::internal(format!(
                    "Expected a current plane ID when processing EnableSketchMode command, but we have none"
                ))
            })?;
            let existing_plane = artifacts.get(&ArtifactId::new(current_plane_id));
            match existing_plane {
                Some(Artifact::Wall(wall)) => {
                    return Ok(vec![Artifact::Wall(Wall {
                        id: current_plane_id.into(),
                        seg_id: wall.seg_id,
                        edge_cut_ids: wall.edge_cut_ids.clone(),
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
                        code_ref: CodeRef { range },
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
                sweep_id: ArtifactId::new(Uuid::new_v4()),
                solid2d_id: None,
                code_ref: CodeRef { range },
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
                    edge_cut_ids: wall.edge_cut_ids.clone(),
                    sweep_id: wall.sweep_id,
                    path_ids: vec![id],
                }));
            }
            return Ok(return_arr);
        }
        ModelingCmd::ClosePath(_) | ModelingCmd::ExtendPath(_) => {
            let mut return_arr = Vec::new();
            let path_id = ArtifactId::new(match cmd {
                ModelingCmd::ClosePath(c) => c.path_id,
                ModelingCmd::ExtendPath(e) => e.path.into(),
                _ => unreachable!(),
            });
            return_arr.push(Artifact::Segment(Segment {
                id,
                path_id: path_id.into(),
                surface_id: ArtifactId::fake_placeholder(),
                edge_ids: Vec::new(),
                edge_cut_id: None,
                code_ref: CodeRef { range },
            }));
            let path = artifacts.get(&path_id);
            if let Some(Artifact::Path(path)) = path {
                return_arr.push(Artifact::Path(Path {
                    id: path.id,
                    plane_id: path.plane_id,
                    seg_ids: vec![id],
                    sweep_id: path.sweep_id,
                    solid2d_id: path.solid2d_id,
                    code_ref: path.code_ref.clone(),
                }));
            }
            match response {
                OkModelingCmdResponse::ClosePath(close_path) => {
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
                _ => {}
            }
            return Ok(return_arr);
        }
        ModelingCmd::Extrude(_) | ModelingCmd::Revolve(_) => {
            let mut return_arr = Vec::new();
            let (sub_type, target) = match cmd {
                ModelingCmd::Extrude(e) => (SweepSubType::Extrusion, e.target.into()),
                ModelingCmd::Revolve(r) => (SweepSubType::Revolve, r.target.into()),
                _ => unreachable!(),
            };
            return_arr.push(Artifact::Sweep(Sweep {
                id,
                sub_type,
                path_id: target,
                surface_ids: Vec::new(),
                edge_ids: Vec::new(),
                code_ref: CodeRef { range },
            }));
            let path = artifacts.get(&target);
            if let Some(Artifact::Path(path)) = path {
                let mut new_path = path.clone();
                new_path.sweep_id = id;
                return_arr.push(Artifact::Path(new_path));
            }
            return Ok(return_arr);
        }
        ModelingCmd::Solid3dGetExtrusionFaceInfo(_) => match response {
            OkModelingCmdResponse::Solid3dGetExtrusionFaceInfo(face_info) => {
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
                    return_arr.push(Artifact::Wall(Wall {
                        id: face_id,
                        seg_id: curve_id,
                        edge_cut_ids: Vec::new(),
                        sweep_id: path.sweep_id,
                        path_ids: vec![],
                    }));
                    let mut new_seg = seg.clone();
                    new_seg.surface_id = face_id;
                    return_arr.push(Artifact::Segment(new_seg));
                    if let Some(Artifact::Sweep(sweep)) = artifacts.get(&path.sweep_id) {
                        let mut new_sweep = sweep.clone();
                        new_sweep.surface_ids = vec![face_id];
                        return_arr.push(Artifact::Sweep(new_sweep));
                    }
                }
                for face in &face_info.faces {
                    if face.cap != ExtrusionFaceCapType::Top && face.cap != ExtrusionFaceCapType::Bottom {
                        continue;
                    }
                    let Some(face_id) = face.face_id.map(ArtifactId::new) else {
                        continue;
                    };
                    let path = last_path.ok_or_else(|| {
                        KclError::internal(format!(
                            "Expected a last path to exist when processing Solid3dGetExtrusionFaceInfo command: {id:?}"
                        ))
                    })?;
                    return_arr.push(Artifact::Cap(Cap {
                        id: face_id,
                        sub_type: match face.cap {
                            ExtrusionFaceCapType::Bottom => CapSubType::Start,
                            ExtrusionFaceCapType::Top => CapSubType::End,
                            _ => unreachable!(),
                        },
                        edge_cut_ids: Vec::new(),
                        sweep_id: path.sweep_id,
                        path_ids: Vec::new(),
                    }));
                    let Some(Artifact::Sweep(sweep)) = artifacts.get(&path.sweep_id) else {
                        continue;
                    };
                    let mut new_sweep = sweep.clone();
                    new_sweep.surface_ids = vec![face_id];
                    return_arr.push(Artifact::Sweep(new_sweep));
                }
                return Ok(return_arr);
            }
            _ => {}
        },
        ModelingCmd::Solid3dGetOppositeEdge(_) | ModelingCmd::Solid3dGetNextAdjacentEdge(_) => todo!(),
        ModelingCmd::Solid3dGetPrevAdjacentEdge(_) => todo!(),
        ModelingCmd::EngineUtilEvaluatePath(_) => todo!(),
        ModelingCmd::Solid3dFilletEdge(_) => todo!(),
        _ => {}
    }

    Ok(Vec::new())
}
