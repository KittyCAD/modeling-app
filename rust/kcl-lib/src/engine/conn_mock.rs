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
use kittycad_modeling_cmds::{self as kcmc, ImportFiles, ModelingCmd, websocket::ModelingCmdReq};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    SourceRange,
    engine::{AsyncTasks, EngineStats},
    errors::KclError,
    exec::DefaultPlanes,
    execution::IdGenerator,
};

#[derive(Debug, Clone)]
pub struct EngineConnection {
    batch: Arc<RwLock<Vec<(WebSocketRequest, SourceRange)>>>,
    batch_end: Arc<RwLock<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>>,
    ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>>,
    responses: Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>>,
    /// The default planes for the scene.
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    stats: EngineStats,
    async_tasks: AsyncTasks,
}

impl EngineConnection {
    pub async fn new() -> Result<EngineConnection> {
        Ok(EngineConnection {
            batch: Arc::new(RwLock::new(Vec::new())),
            batch_end: Arc::new(RwLock::new(IndexMap::new())),
            ids_of_async_commands: Arc::new(RwLock::new(IndexMap::new())),
            responses: Arc::new(RwLock::new(IndexMap::new())),
            default_planes: Default::default(),
            stats: Default::default(),
            async_tasks: AsyncTasks::new(),
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
        self.responses.clone()
    }

    fn stats(&self) -> &EngineStats {
        &self.stats
    }

    fn ids_of_async_commands(&self) -> Arc<RwLock<IndexMap<Uuid, SourceRange>>> {
        self.ids_of_async_commands.clone()
    }

    fn async_tasks(&self) -> AsyncTasks {
        self.async_tasks.clone()
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

    async fn get_debug(&self) -> Option<OkWebSocketResponseData> {
        None
    }

    async fn fetch_debug(&self) -> Result<(), KclError> {
        unimplemented!();
    }

    async fn inner_fire_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        // Pop off the id we care about.
        self.ids_of_async_commands.write().await.swap_remove(&id);

        // Add the response to our responses.
        let response = self
            .inner_send_modeling_cmd(id, source_range, cmd, id_to_source_range)
            .await?;
        self.responses().write().await.insert(id, response);

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
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                cmd: ModelingCmd::ImportFiles(ImportFiles { .. }),
                cmd_id,
            }) => Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::ImportFiles(
                        kittycad_modeling_cmds::output::ImportFiles {
                            object_id: cmd_id.into(),
                        },
                    ),
                },
                success: true,
            })),
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
