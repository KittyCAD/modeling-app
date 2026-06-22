//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.
use std::collections::HashMap;
use std::sync::Arc;

use indexmap::IndexMap;
use kcmc::websocket::FailureWebSocketResponse;
use kcmc::websocket::WebSocketRequest;
use kcmc::websocket::WebSocketResponse;
use kittycad_modeling_cmds as kcmc;
use tokio::sync::RwLock;
use uuid::Uuid;
use wasm_bindgen::prelude::*;

use super::EngineTransport;
use super::ResponseInformation;
use super::TransportCloseError;
use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;

#[wasm_bindgen(module = "/../../src/network/connectionManager.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type EngineCommandManager;

    #[wasm_bindgen(constructor)]
    pub fn new() -> EngineCommandManager;

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

    pub async fn send_response(&self, data: js_sys::Uint8Array) {
        let ws_result: WebSocketResponse = match rmp_serde::from_slice(&data.to_vec()) {
            Ok(res) => res,
            Err(_) => return,
        };

        let Some(id) = ws_result.request_id() else {
            return;
        };

        self.add(id, ws_result).await;
    }
}

impl ResponseContext {
    pub async fn add(&self, id: Uuid, response: WebSocketResponse) {
        self.responses.write().await.insert(id, response);
    }

    pub fn response_information(&self) -> ResponseInformation {
        ResponseInformation::new(self.responses.clone())
    }
}

/// Runs inside a web browser's WASM sandbox, using functions from the JavaScript
/// engine to transport data to/from the engine.
pub struct WasmTransport {
    manager: Arc<EngineCommandManager>,
}

impl WasmTransport {
    pub fn new(manager: EngineCommandManager) -> Self {
        Self {
            manager: Arc::new(manager),
        }
    }

    fn serialize_args(
        source_range: SourceRange,
        cmd: &WebSocketRequest,
        id_to_source_range: &HashMap<Uuid, SourceRange>,
    ) -> Result<(String, String, String), KclError> {
        let source_range_str = serde_json::to_string(&source_range).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to serialize source range: {:?}", e),
                vec![source_range],
            ))
        })?;
        let cmd_str = serde_json::to_string(cmd).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to serialize modeling command: {:?}", e),
                vec![source_range],
            ))
        })?;
        let id_to_source_range_str = serde_json::to_string(id_to_source_range).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to serialize id to source range: {:?}", e),
                vec![source_range],
            ))
        })?;

        Ok((source_range_str, cmd_str, id_to_source_range_str))
    }

    fn js_error_to_kcl_error(e: JsValue, source_range: SourceRange) -> KclError {
        let err_str = e.as_string().unwrap_or_default();
        if let Ok(FailureWebSocketResponse { errors, .. }) = serde_json::from_str(&err_str) {
            KclError::new_engine(KclErrorDetails::new(
                errors.iter().map(|e| e.message.clone()).collect::<Vec<_>>().join("\n"),
                vec![source_range],
            ))
        } else if let Ok(data) = serde_json::from_str::<Vec<FailureWebSocketResponse>>(&err_str) {
            if let Some(data) = data.first() {
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
    }
}

// Safety: WebAssembly runs this transport on the browser's single thread.
unsafe impl Send for WasmTransport {}
unsafe impl Sync for WasmTransport {}

#[async_trait::async_trait]
impl EngineTransport for WasmTransport {
    async fn inner_fire_modeling_cmd(
        &self,
        cmd_id: Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        let (source_range_str, cmd_str, id_to_source_range_str) =
            Self::serialize_args(source_range, &cmd, &id_to_source_range)?;

        self.manager
            .fire_modeling_cmd_from_wasm(cmd_id.to_string(), source_range_str, cmd_str, id_to_source_range_str)
            .map_err(|e| KclError::new_engine(KclErrorDetails::new(e.to_string().into(), vec![source_range])))?;

        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        cmd_id: Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        let (source_range_str, cmd_str, id_to_source_range_str) =
            Self::serialize_args(source_range, &cmd, &id_to_source_range)?;

        let promise = self
            .manager
            .send_modeling_cmd_from_wasm(cmd_id.to_string(), source_range_str, cmd_str, id_to_source_range_str)
            .map_err(|e| KclError::new_engine(KclErrorDetails::new(e.to_string().into(), vec![source_range])))?;

        let value = crate::wasm::JsFuture::from(promise)
            .await
            .map_err(|e| Self::js_error_to_kcl_error(e, source_range))?;

        if value.is_null() || value.is_undefined() {
            return Err(KclError::new_engine(KclErrorDetails::new(
                "Received null or undefined response from engine".into(),
                vec![source_range],
            )));
        }

        let data = js_sys::Uint8Array::from(value);
        let ws_result: WebSocketResponse = rmp_serde::from_slice(&data.to_vec()).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to deserialize msgpack response from engine: {:?}", e),
                vec![source_range],
            ))
        })?;

        Ok(ws_result)
    }

    async fn start_new_session(&self, source_range: SourceRange) -> Result<(), KclError> {
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

    async fn close(&self) -> Result<(), TransportCloseError> {
        Ok(())
    }
}
