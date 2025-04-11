//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::{
    ok_response::OkModelingCmdResponse,
    websocket::{
        BatchResponse, ModelingBatch, OkWebSocketResponseData, SuccessWebSocketResponse, WebSocketRequest,
        WebSocketResponse,
    },
};
use kittycad_modeling_cmds::{self as kcmc};
use tokio::sync::RwLock;
use uuid::Uuid;

use super::EngineStats;
use crate::{
    errors::KclError,
    exec::DefaultPlanes,
    execution::{ArtifactCommand, IdGenerator},
    SourceRange,
};

#[derive(Debug, Clone)]
pub struct EngineConnection {
    batch: Arc<RwLock<Vec<(WebSocketRequest, SourceRange)>>>,
    batch_end: Arc<RwLock<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>>,
    artifact_commands: Arc<RwLock<Vec<ArtifactCommand>>>,
    /// The default planes for the scene.
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    stats: EngineStats,
}

impl EngineConnection {
    pub async fn new() -> Result<EngineConnection> {
        Ok(EngineConnection {
            batch: Arc::new(RwLock::new(Vec::new())),
            batch_end: Arc::new(RwLock::new(IndexMap::new())),
            artifact_commands: Arc::new(RwLock::new(Vec::new())),
            default_planes: Default::default(),
            stats: Default::default(),
        })
    }
}

#[async_trait::async_trait]
impl crate::engine::EngineManager for EngineConnection {
    fn batch(&self) -> Arc<RwLock<Vec<(WebSocketRequest, SourceRange)>>> {
        self.batch.clone()
    }

    fn batch_end(&self) -> Arc<RwLock<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>> {
        self.batch_end.clone()
    }

    fn responses(&self) -> Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>> {
        Arc::new(RwLock::new(IndexMap::new()))
    }

    fn stats(&self) -> &EngineStats {
        &self.stats
    }

    fn artifact_commands(&self) -> Arc<RwLock<Vec<ArtifactCommand>>> {
        self.artifact_commands.clone()
    }

    fn get_default_planes(&self) -> Arc<RwLock<Option<DefaultPlanes>>> {
        self.default_planes.clone()
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
        _id_to_source_range: HashMap<Uuid, SourceRange>,
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
            WebSocketRequest::ModelingCmdReq(_) => Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::Empty {},
                },
                success: true,
            })),
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
