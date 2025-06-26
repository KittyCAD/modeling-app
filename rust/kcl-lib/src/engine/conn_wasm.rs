//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.
use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::websocket::{OkWebSocketResponseData, WebSocketRequest, WebSocketResponse};
use kittycad_modeling_cmds as kcmc;
use tokio::sync::RwLock;
use uuid::Uuid;
use wasm_bindgen::prelude::*;

use crate::{
    SourceRange,
    engine::{AsyncTasks, EngineStats},
    errors::{KclError, KclErrorDetails},
    execution::{DefaultPlanes, IdGenerator},
};

#[wasm_bindgen(module = "/../../src/lang/std/engineConnection.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type EngineCommandManager;

    #[wasm_bindgen(constructor)]
    pub fn new() -> EngineCommandManager;

    #[wasm_bindgen(method, js_name = startFromWasm, catch)]
    pub async fn start_from_wasm(this: &EngineCommandManager, token: &str) -> Result<JsValue, js_sys::Error>;

    #[wasm_bindgen(method, js_name = fireModelingCommandFromWasm, catch)]
    fn fire_modeling_cmd_from_wasm(
        this: &EngineCommandManager,
        id: String,
        rangeStr: String,
        cmdStr: String,
        idToRangeStr: String,
    ) -> Result<(), js_sys::Error>;

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
    response_context: Arc<ResponseContext>,
    batch: Arc<RwLock<Vec<(WebSocketRequest, SourceRange)>>>,
    batch_end: Arc<RwLock<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>>,
    ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>>,
    /// The default planes for the scene.
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    stats: EngineStats,
    async_tasks: AsyncTasks,
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct ResponseContext {
    responses: Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>>,
}

#[wasm_bindgen]
impl ResponseContext {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            responses: Arc::new(RwLock::new(IndexMap::new())),
        }
    }

    // Add a response to the context.
    pub async fn send_response(&self, data: js_sys::Uint8Array) {
        let ws_result: WebSocketResponse = match bson::from_slice(&data.to_vec()) {
            Ok(res) => res,
            Err(_) => {
                // We don't care about the error if we can't parse it.
                return;
            }
        };

        let id = match &ws_result {
            WebSocketResponse::Success(res) => res.request_id,
            WebSocketResponse::Failure(res) => res.request_id,
        };

        let Some(id) = id else {
            // We only care if we have an id.
            return;
        };

        // Add this response to our responses.
        self.add(id, ws_result.clone()).await;
    }
}

impl ResponseContext {
    pub async fn add(&self, id: Uuid, response: WebSocketResponse) {
        self.responses.write().await.insert(id, response);
    }

    pub fn responses(&self) -> Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>> {
        self.responses.clone()
    }
}

// Safety: WebAssembly will only ever run in a single-threaded context.
unsafe impl Send for EngineConnection {}
unsafe impl Sync for EngineConnection {}

impl EngineConnection {
    pub async fn new(
        manager: EngineCommandManager,
        response_context: Arc<ResponseContext>,
    ) -> Result<EngineConnection, JsValue> {
        #[allow(clippy::arc_with_non_send_sync)]
        Ok(EngineConnection {
            manager: Arc::new(manager),
            batch: Arc::new(RwLock::new(Vec::new())),
            batch_end: Arc::new(RwLock::new(IndexMap::new())),
            response_context,
            ids_of_async_commands: Arc::new(RwLock::new(IndexMap::new())),
            default_planes: Default::default(),
            stats: Default::default(),
            async_tasks: AsyncTasks::new(),
        })
    }

    async fn do_fire_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<uuid::Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        let source_range_str = serde_json::to_string(&source_range).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to serialize source range: {:?}", e),
                vec![source_range],
            ))
        })?;
        let cmd_str = serde_json::to_string(&cmd).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to serialize modeling command: {:?}", e),
                vec![source_range],
            ))
        })?;
        let id_to_source_range_str = serde_json::to_string(&id_to_source_range).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to serialize id to source range: {:?}", e),
                vec![source_range],
            ))
        })?;

        self.manager
            .fire_modeling_cmd_from_wasm(id.to_string(), source_range_str, cmd_str, id_to_source_range_str)
            .map_err(|e| KclError::new_engine(KclErrorDetails::new(e.to_string().into(), vec![source_range])))?;

        Ok(())
    }

    async fn do_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<uuid::Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        let source_range_str = serde_json::to_string(&source_range).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to serialize source range: {:?}", e),
                vec![source_range],
            ))
        })?;
        let cmd_str = serde_json::to_string(&cmd).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to serialize modeling command: {:?}", e),
                vec![source_range],
            ))
        })?;
        let id_to_source_range_str = serde_json::to_string(&id_to_source_range).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to serialize id to source range: {:?}", e),
                vec![source_range],
            ))
        })?;

        let promise = self
            .manager
            .send_modeling_cmd_from_wasm(id.to_string(), source_range_str, cmd_str, id_to_source_range_str)
            .map_err(|e| KclError::new_engine(KclErrorDetails::new(e.to_string().into(), vec![source_range])))?;

        let value = crate::wasm::JsFuture::from(promise).await.map_err(|e| {
            // Try to parse the error as an engine error.
            let err_str = e.as_string().unwrap_or_default();
            if let Ok(kittycad_modeling_cmds::websocket::FailureWebSocketResponse { errors, .. }) =
                serde_json::from_str(&err_str)
            {
                KclError::new_engine(KclErrorDetails::new(
                    errors.iter().map(|e| e.message.clone()).collect::<Vec<_>>().join("\n"),
                    vec![source_range],
                ))
            } else if let Ok(data) =
                serde_json::from_str::<Vec<kittycad_modeling_cmds::websocket::FailureWebSocketResponse>>(&err_str)
            {
                if let Some(data) = data.first() {
                    // It could also be an array of responses.
                    KclError::new_engine(KclErrorDetails::new(
                        data.errors
                            .iter()
                            .map(|e| e.message.clone())
                            .collect::<Vec<_>>()
                            .join("\n"),
                        vec![source_range],
                    ))
                } else {
                    KclError::new_engine(KclErrorDetails::new(
                        "Received empty response from engine".into(),
                        vec![source_range],
                    ))
                }
            } else {
                KclError::new_engine(KclErrorDetails::new(
                    format!("Failed to wait for promise from send modeling command: {:?}", e),
                    vec![source_range],
                ))
            }
        })?;

        if value.is_null() || value.is_undefined() {
            return Err(KclError::new_engine(KclErrorDetails::new(
                "Received null or undefined response from engine".into(),
                vec![source_range],
            )));
        }

        // Convert JsValue to a Uint8Array
        let data = js_sys::Uint8Array::from(value);

        let ws_result: WebSocketResponse = bson::from_slice(&data.to_vec()).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to deserialize bson response from engine: {:?}", e),
                vec![source_range],
            ))
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
        self.response_context.responses.clone()
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
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<(), KclError> {
        // Remake the default planes, since they would have been removed after the scene was cleared.
        let new_planes = self.new_default_planes(id_generator, source_range).await?;
        *self.default_planes.write().await = Some(new_planes);

        // Start a new session.
        let promise = self
            .manager
            .start_new_session()
            .map_err(|e| KclError::new_engine(KclErrorDetails::new(e.to_string().into(), vec![source_range])))?;

        crate::wasm::JsFuture::from(promise).await.map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to wait for promise from start new session: {:?}", e),
                vec![source_range],
            ))
        })?;

        Ok(())
    }

    async fn fetch_debug(&self) -> Result<(), KclError> {
        unimplemented!();
    }

    async fn get_debug(&self) -> Option<OkWebSocketResponseData> {
        None
    }

    async fn inner_fire_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        self.do_fire_modeling_cmd(id, source_range, cmd, id_to_source_range)
            .await?;

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

        self.response_context.add(id, ws_result.clone()).await;

        Ok(ws_result)
    }

    // maybe we can actually impl this here? not sure how atm.
    async fn close(&self) {}
}
