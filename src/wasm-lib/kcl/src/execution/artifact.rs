use dashmap::DashMap;
use indexmap::IndexMap;
use kittycad_modeling_cmds::{websocket::WebSocketResponse, EnableSketchMode, ModelingCmd, SketchModeDisable};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{parsing::ast::types::Node, Program, SourceRange};

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactGraph {
    #[serde(flatten)]
    map: IndexMap<ArtifactId, Artifact>,
}

/// A command that may create or update artifacts on the TS side.  Because
/// engine commands are batched, we don't have the response yet when these are
/// created.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
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
#[ts(export)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: ArtifactId,
    #[serde(flatten)]
    pub inner: ArtifactInner,
    pub source_range: SourceRange,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum ArtifactInner {
    #[serde(rename_all = "camelCase")]
    StartSketchOnFace { face_id: Uuid },
    #[serde(rename_all = "camelCase")]
    StartSketchOnPlane { plane_id: Uuid },
}

pub(crate) fn build_artifact_graph(
    artifact_commands: &[ArtifactCommand],
    responses: &DashMap<Uuid, WebSocketResponse>,
    ast: &Node<Program>,
    exec_artifacts: &[Artifact],
) -> ArtifactGraph {
    let mut map = IndexMap::new();

    let mut current_plane_id = None;

    for artifact_command in artifact_commands {
        if let ModelingCmd::EnableSketchMode(EnableSketchMode { entity_id, .. }) = artifact_command.command {
            current_plane_id = Some(entity_id);
        }
        if let ModelingCmd::SketchModeDisable(SketchModeDisable { .. }) = artifact_command.command {
            current_plane_id = None;
        }

        let artifact_updates = artifacts_to_update(artifact_command, responses, current_plane_id, ast, exec_artifacts);
        for (id, artifact) in artifact_updates {
            map.insert(id, artifact);
        }
    }

    ArtifactGraph { map }
}

fn artifacts_to_update(
    artifact_command: &ArtifactCommand,
    responses: &DashMap<Uuid, WebSocketResponse>,
    current_plane_id: Option<Uuid>,
    ast: &Node<Program>,
    exec_artifacts: &[Artifact],
) -> Vec<(ArtifactId, Artifact)> {
    let mut artifacts = Vec::new();

    todo!();

    artifacts
}
