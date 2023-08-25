//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use anyhow::Result;
use kittycad::types::WebSocketRequest;
use wasm_bindgen::prelude::*;

use crate::errors::{KclError, KclErrorDetails};

#[wasm_bindgen(module = "/../../lang/std/engineConnection.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type EngineCommandManager;

    #[wasm_bindgen(method)]
    fn sendModelingCommandFromWasm(
        this: &EngineCommandManager,
        id: String,
        rangeStr: String,
        cmdStr: String,
    ) -> js_sys::Promise;
}

#[derive(Debug, Clone)]
pub struct EngineConnection {
    manager: EngineCommandManager,
}

impl EngineConnection {
    pub async fn new(manager: EngineCommandManager) -> Result<EngineConnection, JsValue> {
        Ok(EngineConnection { manager })
    }

    pub fn send_modeling_cmd(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
        let source_range_str = serde_json::to_string(&source_range).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to serialize source range: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;
        let ws_msg = WebSocketRequest::ModelingCmdReq { cmd, cmd_id: id };
        let cmd_str = serde_json::to_string(&ws_msg).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to serialize modeling command: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;
        let _ = self
            .manager
            .sendModelingCommandFromWasm(id.to_string(), source_range_str, cmd_str);
        Ok(())
    }
}
