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
use kittycad_modeling_cmds::{self as kcmc};

use crate::{
    errors::KclError,
    executor::{DefaultPlanes, IdGenerator},
};

#[derive(Debug, Clone)]
pub struct EngineConnection {
    batch: Arc<Mutex<Vec<(WebSocketRequest, crate::executor::SourceRange)>>>,
    batch_end: Arc<Mutex<IndexMap<uuid::Uuid, (WebSocketRequest, crate::executor::SourceRange)>>>,
}

impl EngineConnection {
    pub async fn new() -> Result<EngineConnection> {
        Ok(EngineConnection {
            batch: Arc::new(Mutex::new(Vec::new())),
            batch_end: Arc::new(Mutex::new(IndexMap::new())),
        })
    }
}

#[async_trait::async_trait]
impl crate::engine::EngineManager for EngineConnection {
    fn batch(&self) -> Arc<Mutex<Vec<(WebSocketRequest, crate::executor::SourceRange)>>> {
        self.batch.clone()
    }

    fn batch_end(&self) -> Arc<Mutex<IndexMap<uuid::Uuid, (WebSocketRequest, crate::executor::SourceRange)>>> {
        self.batch_end.clone()
    }

    async fn default_planes(
        &self,
        _id_generator: &mut IdGenerator,
        _source_range: crate::executor::SourceRange,
    ) -> Result<DefaultPlanes, KclError> {
        Ok(DefaultPlanes::default())
    }

    async fn clear_scene_post_hook(
        &self,
        _id_generator: &mut IdGenerator,
        _source_range: crate::executor::SourceRange,
    ) -> Result<(), KclError> {
        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        _source_range: crate::executor::SourceRange,
        cmd: WebSocketRequest,
        _id_to_source_range: std::collections::HashMap<uuid::Uuid, crate::executor::SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        match cmd {
            WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
                ref requests,
                batch_id: _,
                responses: _,
            }) => {
                // Create the empty responses.
                let mut responses = HashMap::new();
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
            _ => Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::Empty {},
                },
                success: true,
            })),
        }
    }
}
