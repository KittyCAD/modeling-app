//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::{
    ok_response::OkModelingCmdResponse,
    websocket::{
        BatchResponse, ModelingBatch, OkWebSocketResponseData, SuccessWebSocketResponse, WebSocketRequest,
        WebSocketResponse,
    },
};
use kittycad_modeling_cmds::{self as kcmc, id::ModelingCmdId, ModelingCmd};
use uuid::Uuid;

use super::ExecutionKind;
use crate::{
    errors::KclError,
    exec::DefaultPlanes,
    execution::{ArtifactCommand, IdGenerator},
    SourceRange,
};

#[derive(Debug, Clone)]
pub struct EngineConnection {
    batch: Arc<Mutex<Vec<(WebSocketRequest, SourceRange)>>>,
    batch_end: Arc<Mutex<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>>,
    artifact_commands: Arc<Mutex<Vec<ArtifactCommand>>>,
    execution_kind: Arc<Mutex<ExecutionKind>>,
}

impl EngineConnection {
    pub async fn new() -> Result<EngineConnection> {
        Ok(EngineConnection {
            batch: Arc::new(Mutex::new(Vec::new())),
            batch_end: Arc::new(Mutex::new(IndexMap::new())),
            artifact_commands: Arc::new(Mutex::new(Vec::new())),
            execution_kind: Default::default(),
        })
    }

    fn handle_command(
        &self,
        cmd: &ModelingCmd,
        cmd_id: ModelingCmdId,
        id_to_source_range: &HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        let cmd_id = *cmd_id.as_ref();
        let range = id_to_source_range
            .get(&cmd_id)
            .copied()
            .ok_or_else(|| KclError::internal(format!("Failed to get source range for command ID: {:?}", cmd_id)))?;

        // Add artifact command.
        let mut artifact_commands = self.artifact_commands.lock().unwrap();
        artifact_commands.push(ArtifactCommand {
            cmd_id,
            range,
            command: cmd.clone(),
        });
        Ok(())
    }
}

#[async_trait::async_trait]
impl crate::engine::EngineManager for EngineConnection {
    fn batch(&self) -> Arc<Mutex<Vec<(WebSocketRequest, SourceRange)>>> {
        self.batch.clone()
    }

    fn batch_end(&self) -> Arc<Mutex<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>> {
        self.batch_end.clone()
    }

    fn responses(&self) -> IndexMap<Uuid, WebSocketResponse> {
        IndexMap::new()
    }

    fn take_artifact_commands(&self) -> Vec<ArtifactCommand> {
        let mut artifact_commands = self.artifact_commands.lock().unwrap();
        std::mem::take(&mut *artifact_commands)
    }

    fn execution_kind(&self) -> ExecutionKind {
        let guard = self.execution_kind.lock().unwrap();
        *guard
    }

    fn replace_execution_kind(&self, execution_kind: ExecutionKind) -> ExecutionKind {
        let mut guard = self.execution_kind.lock().unwrap();
        let original = *guard;
        *guard = execution_kind;
        original
    }

    async fn default_planes(
        &self,
        _id_generator: &mut IdGenerator,
        _source_range: SourceRange,
    ) -> Result<DefaultPlanes, KclError> {
        Ok(DefaultPlanes::default())
    }

    async fn clear_scene_post_hook(
        &self,
        _id_generator: &mut IdGenerator,
        _source_range: SourceRange,
    ) -> Result<(), KclError> {
        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        _source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        match cmd {
            WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
                ref requests,
                batch_id: _,
                responses: _,
            }) => {
                // Create the empty responses.
                let mut responses = HashMap::with_capacity(requests.len());
                for request in requests {
                    self.handle_command(&request.cmd, request.cmd_id, &id_to_source_range)?;
                    responses.insert(
                        request.cmd_id,
                        BatchResponse::Success {
                            response: OkModelingCmdResponse::Empty {},
                        },
                    );
                }
                Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::ModelingBatch { responses },
                    success: true,
                }))
            }
            WebSocketRequest::ModelingCmdReq(request) => {
                self.handle_command(&request.cmd, request.cmd_id, &id_to_source_range)?;

                Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::Modeling {
                        modeling_response: OkModelingCmdResponse::Empty {},
                    },
                    success: true,
                }))
            }
            _ => Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::Empty {},
                },
                success: true,
            })),
        }
    }

    async fn close(&self) {}
}
