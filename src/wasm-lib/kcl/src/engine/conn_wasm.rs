//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.
use std::sync::{Arc, Mutex};

use anyhow::Result;
use kittycad::types::WebSocketRequest;
use wasm_bindgen::prelude::*;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::DefaultPlanes,
};

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
        idToRangeStr: String,
    ) -> Result<js_sys::Promise, js_sys::Error>;

    #[wasm_bindgen(method, js_name = wasmGetDefaultPlanes, catch)]
    fn get_default_planes(this: &EngineCommandManager) -> Result<js_sys::Promise, js_sys::Error>;

    #[wasm_bindgen(method, js_name = clearDefaultPlanes, catch)]
    fn clear_default_planes(this: &EngineCommandManager) -> Result<(), js_sys::Error>;

    #[wasm_bindgen(method, js_name = startNewSession, catch)]
    fn start_new_session(this: &EngineCommandManager) -> Result<js_sys::Promise, js_sys::Error>;
}

#[derive(Debug, Clone)]
pub struct EngineConnection {
    manager: Arc<EngineCommandManager>,
    batch: Arc<Mutex<Vec<(WebSocketRequest, crate::executor::SourceRange)>>>,
}

// Safety: WebAssembly will only ever run in a single-threaded context.
unsafe impl Send for EngineConnection {}
unsafe impl Sync for EngineConnection {}

impl EngineConnection {
    pub async fn new(manager: EngineCommandManager) -> Result<EngineConnection, JsValue> {
        Ok(EngineConnection {
            manager: Arc::new(manager),
            batch: Arc::new(Mutex::new(Vec::new())),
        })
    }
}

#[async_trait::async_trait]
impl crate::engine::EngineManager for EngineConnection {
    fn batch(&self) -> Arc<Mutex<Vec<(WebSocketRequest, crate::executor::SourceRange)>>> {
        self.batch.clone()
    }

    async fn default_planes(&self, source_range: crate::executor::SourceRange) -> Result<DefaultPlanes, KclError> {
        // Get the default planes.
        let promise = self.manager.get_default_planes().map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: e.to_string().into(),
                source_ranges: vec![source_range],
            })
        })?;

        let value = crate::wasm::JsFuture::from(promise).await.map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to wait for promise from get default planes: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        // Parse the value as a string.
        let s = value.as_string().ok_or_else(|| {
            KclError::Engine(KclErrorDetails {
                message: format!(
                    "Failed to get string from response from get default planes: `{:?}`",
                    value
                ),
                source_ranges: vec![source_range],
            })
        })?;

        // Deserialize the response.
        let default_planes: DefaultPlanes = serde_json::from_str(&s).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to deserialize default planes: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        Ok(default_planes)
    }

    async fn clear_scene_post_hook(&self, source_range: crate::executor::SourceRange) -> Result<(), KclError> {
        self.manager.clear_default_planes().map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: e.to_string().into(),
                source_ranges: vec![source_range],
            })
        })?;

        // Start a new session.
        let promise = self.manager.start_new_session().map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: e.to_string().into(),
                source_ranges: vec![source_range],
            })
        })?;

        crate::wasm::JsFuture::from(promise).await.map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to wait for promise from start new session: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::WebSocketRequest,
        id_to_source_range: std::collections::HashMap<uuid::Uuid, crate::executor::SourceRange>,
    ) -> Result<kittycad::types::OkWebSocketResponseData, KclError> {
        let source_range_str = serde_json::to_string(&source_range).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to serialize source range: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;
        let cmd_str = serde_json::to_string(&cmd).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to serialize modeling command: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;
        let id_to_source_range_str = serde_json::to_string(&id_to_source_range).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to serialize id to source range: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        let promise = self
            .manager
            .send_modeling_cmd_from_wasm(id.to_string(), source_range_str, cmd_str, id_to_source_range_str)
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: e.to_string().into(),
                    source_ranges: vec![source_range],
                })
            })?;

        let value = crate::wasm::JsFuture::from(promise).await.map_err(|e| {
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

        let ws_result: kittycad::types::WebSocketResponse = serde_json::from_str(&s).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to deserialize response from engine: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        if let Some(data) = &ws_result.resp {
            Ok(data.clone())
        } else if let Some(errors) = &ws_result.errors {
            Err(KclError::Engine(KclErrorDetails {
                message: format!("Modeling command failed: {:?}", errors),
                source_ranges: vec![source_range],
            }))
        } else {
            // We should never get here.
            Err(KclError::Engine(KclErrorDetails {
                message: "Modeling command failed: no response or errors".to_string(),
                source_ranges: vec![source_range],
            }))
        }
    }
}
