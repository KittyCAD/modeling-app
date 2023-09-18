//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use anyhow::Result;
use kittycad::types::OkWebSocketResponseData;

use crate::errors::KclError;

#[derive(Debug)]
pub struct EngineConnection {}

impl EngineConnection {
    pub async fn new() -> Result<EngineConnection> {
        Ok(EngineConnection {})
    }
}

#[async_trait::async_trait(?Send)]
impl crate::engine::EngineManager for EngineConnection {
    fn send_modeling_cmd(
        &mut self,
        _id: uuid::Uuid,
        _source_range: crate::executor::SourceRange,
        _cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
        Ok(())
    }

    fn send_modeling_cmd_get_response_blocking(
        &mut self,
        _id: uuid::Uuid,
        _source_range: crate::executor::SourceRange,
        _cmd: kittycad::types::ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        Ok(OkWebSocketResponseData::Modeling {
            modeling_response: kittycad::types::OkModelingCmdResponse::Empty {},
        })
    }

    async fn send_modeling_cmd_get_response(
        &mut self,
        _id: uuid::Uuid,
        _source_range: crate::executor::SourceRange,
        _cmd: kittycad::types::ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        Ok(OkWebSocketResponseData::Modeling {
            modeling_response: kittycad::types::OkModelingCmdResponse::Empty {},
        })
    }
}
