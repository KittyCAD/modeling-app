//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use anyhow::Result;
use kittycad::types::OkWebSocketResponseData;

use crate::errors::KclError;

#[derive(Debug, Clone)]
pub struct EngineConnection {}

impl EngineConnection {
    pub async fn new() -> Result<EngineConnection> {
        Ok(EngineConnection {})
    }
}

#[async_trait::async_trait(?Send)]
impl crate::engine::EngineManager for EngineConnection {
    async fn send_modeling_cmd(
        &self,
        _id: uuid::Uuid,
        _source_range: crate::executor::SourceRange,
        _cmd: kittycad::types::ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        todo!()
    }
}
