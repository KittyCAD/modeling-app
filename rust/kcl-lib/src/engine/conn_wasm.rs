//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.
use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::websocket::{WebSocketRequest, WebSocketResponse};
use kittycad_modeling_cmds as kcmc;
use tokio::sync::RwLock;
use uuid::Uuid;
use wasm_bindgen::prelude::*;

use crate::{
    engine::{EngineStats, ExecutionKind},
    errors::{KclError, KclErrorDetails},
    execution::{ArtifactCommand, DefaultPlanes, IdGenerator},
    SourceRange,
};

#[wasm_bindgen(module = "/../../src/lang/std/engineConnection.ts")]
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

    #[wasm_bindgen(method, js_name = startNewSession, catch)]
    fn start_new_session(this: &EngineCommandManager) -> Result<js_sys::Promise, js_sys::Error>;
}

#[derive(Debug, Clone)]
pub struct EngineConnection {
    manager: Arc<EngineCommandManager>,
    batch: Arc<RwLock<Vec<(WebSocketRequest, SourceRange)>>>,
    batch_end: Arc<RwLock<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>>,
    responses: Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>>,
    artifact_commands: Arc<RwLock<Vec<ArtifactCommand>>>,
    execution_kind: Arc<RwLock<ExecutionKind>>,
    /// The default planes for the scene.
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    stats: EngineStats,
}

// Safety: WebAssembly will only ever run in a single-threaded context.
unsafe impl Send for EngineConnection {}
unsafe impl Sync for EngineConnection {}

impl EngineConnection {
    pub async fn new(manager: EngineCommandManager) -> Result<EngineConnection, JsValue> {
        #[allow(clippy::arc_with_non_send_sync)]
        Ok(EngineConnection {
            manager: Arc::new(manager),
            batch: Arc::new(RwLock::new(Vec::new())),
            batch_end: Arc::new(RwLock::new(IndexMap::new())),
            responses: Arc::new(RwLock::new(IndexMap::new())),
            artifact_commands: Arc::new(RwLock::new(Vec::new())),
            execution_kind: Default::default(),
            default_planes: Default::default(),
            stats: Default::default(),
        })
    }

    async fn do_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<uuid::Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
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
            // Try to parse the error as an engine error.
            let err_str = e.as_string().unwrap_or_default();
            if let Ok(kittycad_modeling_cmds::websocket::FailureWebSocketResponse { errors, .. }) =
                serde_json::from_str(&err_str)
            {
                KclError::Engine(KclErrorDetails {
                    message: errors.iter().map(|e| e.message.clone()).collect::<Vec<_>>().join("\n"),
                    source_ranges: vec![source_range],
                })
            } else {
                KclError::Engine(KclErrorDetails {
                    message: format!("Failed to wait for promise from send modeling command: {:?}", e),
                    source_ranges: vec![source_range],
                })
            }
        })?;

        // Convert JsValue to a Uint8Array
        let data = js_sys::Uint8Array::from(value);

        let ws_result: WebSocketResponse = bson::from_slice(&data.to_vec()).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to deserialize bson response from engine: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        Ok(ws_result)
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

    fn artifact_commands(&self) -> Arc<RwLock<Vec<ArtifactCommand>>> {
        self.artifact_commands.clone()
    }

    async fn execution_kind(&self) -> ExecutionKind {
        let guard = self.execution_kind.read().await;
        *guard
    }

    async fn replace_execution_kind(&self, execution_kind: ExecutionKind) -> ExecutionKind {
        let mut guard = self.execution_kind.write().await;
        let original = *guard;
        *guard = execution_kind;
        original
    }

    fn get_default_planes(&self) -> Arc<RwLock<Option<DefaultPlanes>>> {
        self.default_planes.clone()
    }

    async fn clear_scene_post_hook(
        &self,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<(), KclError> {
        // Remake the default planes, since they would have been removed after the scene was cleared.
        let new_planes = self.new_default_planes(id_generator, source_range).await?;
        *self.default_planes.write().await = Some(new_planes);

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
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<uuid::Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        let ws_result = self
            .do_send_modeling_cmd(id, source_range, cmd, id_to_source_range)
            .await?;

        // In isolated mode, we don't save the response.
        if self.execution_kind().await.is_isolated() {
            return Ok(ws_result);
        }

        let mut responses = self.responses.write().await;
        responses.insert(id, ws_result.clone());
        drop(responses);

        Ok(ws_result)
    }

    // maybe we can actually impl this here? not sure how atm.
    async fn close(&self) {}
}
