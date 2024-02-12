//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.
use std::sync::Arc;

use anyhow::Result;
use kittycad::types::WebSocketRequest;
use wasm_bindgen::prelude::*;

use crate::errors::{KclError, KclErrorDetails};

#[wasm_bindgen(module = "/../../lang/std/engineConnection.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type EngineCommandManager;

    #[wasm_bindgen(method, js_name = sendModelingCommandFromWasm, catch)]
    fn send_modeling_cmd_from_wasm(
        this: &EngineCommandManager,
        id: String,
        rangeStr: String,
        cmdStr: String,
    ) -> Result<js_sys::Promise, js_sys::Error>;
}

#[derive(Debug, Clone)]
pub struct EngineConnection {
    manager: Arc<EngineCommandManager>,
}

impl EngineConnection {
    pub async fn new(manager: EngineCommandManager) -> Result<EngineConnection, JsValue> {
        Ok(EngineConnection {
            manager: Arc::new(manager),
        })
    }
}

#[async_trait::async_trait(?Send)]
impl crate::engine::EngineManager for EngineConnection {
    async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<kittycad::types::OkWebSocketResponseData, KclError> {
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

        let promise = self
            .manager
            .send_modeling_cmd_from_wasm(id.to_string(), source_range_str, cmd_str)
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: e.to_string().into(),
                    source_ranges: vec![source_range],
                })
            })?;

        let value = wasm_bindgen_futures::JsFuture::from(promise).await.map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to wait for promise from engine: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        // Parse the value as a string.
        let s = value.as_string().ok_or_else(|| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to get string from response from engine: `{:?}`", value),
                source_ranges: vec![source_range],
            })
        })?;

        let modeling_result: kittycad::types::OkWebSocketResponseData = serde_json::from_str(&s).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to deserialize response from engine: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        Ok(modeling_result)
    }
}
