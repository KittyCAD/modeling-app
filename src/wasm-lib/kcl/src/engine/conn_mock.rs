//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use anyhow::Result;
use kittycad::types::{OkWebSocketResponseData, WebSocketRequest};

use crate::{errors::KclError, executor::DefaultPlanes};

#[derive(Debug, Clone)]
pub struct EngineConnection {
    batch: Arc<Mutex<Vec<(WebSocketRequest, crate::executor::SourceRange)>>>,
}

impl EngineConnection {
    pub async fn new() -> Result<EngineConnection> {
        Ok(EngineConnection {
            batch: Arc::new(Mutex::new(Vec::new())),
        })
    }
}

#[async_trait::async_trait]
impl crate::engine::EngineManager for EngineConnection {
    fn batch(&self) -> Arc<Mutex<Vec<(WebSocketRequest, crate::executor::SourceRange)>>> {
        self.batch.clone()
    }

    async fn default_planes(&self, _source_range: crate::executor::SourceRange) -> Result<DefaultPlanes, KclError> {
        Ok(DefaultPlanes::default())
    }

    async fn clear_scene_post_hook(&self, _source_range: crate::executor::SourceRange) -> Result<(), KclError> {
        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        _id: uuid::Uuid,
        _source_range: crate::executor::SourceRange,
        cmd: kittycad::types::WebSocketRequest,
        _id_to_source_range: std::collections::HashMap<uuid::Uuid, crate::executor::SourceRange>,
    ) -> Result<OkWebSocketResponseData, KclError> {
        match cmd {
            WebSocketRequest::ModelingCmdBatchReq {
                ref requests,
                batch_id: _,
                responses: _,
            } => {
                // Create the empty responses.
                let mut responses = HashMap::new();
                for request in requests {
                    responses.insert(
                        request.cmd_id.to_string(),
                        kittycad::types::BatchResponse {
                            response: Some(kittycad::types::OkModelingCmdResponse::Empty {}),
                            errors: None,
                        },
                    );
                }
                Ok(kittycad::types::OkWebSocketResponseData::ModelingBatch { responses })
            }
            _ => Ok(OkWebSocketResponseData::Modeling {
                modeling_response: kittycad::types::OkModelingCmdResponse::Empty {},
            }),
        }
    }
}
