//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use anyhow::Result;

use crate::errors::KclError;

#[derive(Debug)]
pub struct EngineConnection {}

impl EngineConnection {
    pub async fn new(
        _conn_str: &str,
        _auth_token: &str,
        _origin: &str,
        _export_dir: &str,
    ) -> Result<EngineConnection> {
        Ok(EngineConnection {})
    }

    pub fn send_modeling_cmd(
        &mut self,
        _id: uuid::Uuid,
        _source_range: crate::executor::SourceRange,
        _cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
        Ok(())
    }
}
