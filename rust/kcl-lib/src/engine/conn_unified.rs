use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::Ordering::Relaxed;

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::shared::Color;
use kcmc::websocket::BatchResponse;
use kcmc::websocket::ModelingCmdReq;
use kcmc::websocket::ModelingSessionData;
use kcmc::websocket::OkWebSocketResponseData;
use kcmc::websocket::WebSocketRequest;
use kcmc::websocket::WebSocketResponse;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::websocket::ModelingBatch;
use kittycad_modeling_cmds::{self as kcmc};
use tokio::sync::RwLock;
#[cfg(not(target_arch = "wasm32"))]
use tokio::sync::mpsc;
use uuid::Uuid;
use web_time::Instant;

use crate::ExecutorSettings;
use crate::SourceRange;
use crate::engine::AsyncTasks;
use crate::engine::DEFAULT_PLANE_INFO;
use crate::engine::EngineBatchContext;
use crate::engine::EngineStats;
use crate::engine::GRID_OBJECT_ID;
use crate::engine::GRID_SCALE_TEXT_OBJECT_ID;
use crate::engine::GridScaleBehavior;
use crate::engine::PlaneName;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::DefaultPlanes;
use crate::execution::IdGenerator;
use crate::execution::PlaneInfo;
use crate::settings::types::default_backface_color;
use crate::settings::types::default_backface_color_struct;

pub enum TransportCloseError {}

/// Handles sending requests to the engine, and waiting for responses.
/// Should have at least two implementations:
/// 1. native code on x86/arm with network access
/// 2. wasm in the browser sandbox, using wasm-bindgen to get a handle for
/// sending and receiving data over the websocket.
#[async_trait::async_trait]
pub trait EngineTransport: Send + Sync + 'static {
    /// Send a modeling command without waiting for any response.
    async fn inner_fire_modeling_cmd(
        &self,
        cmd_id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError>;

    /// Send a modeling command, wait for a response.
    async fn inner_send_modeling_cmd(
        &self,
        cmd_id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError>;

    /// If client is reused across sessions, implement this to clear sessions.
    async fn start_new_session(&self, _source_range: SourceRange) -> Result<(), KclError> {
        Ok(())
    }

    /// Close connection to the engine, clean up resources.
    async fn close(&self) -> Result<(), TransportCloseError>;
}

pub mod mock_transport {
    use std::collections::HashMap;

    use kcmc::ok_response::OkModelingCmdResponse;
    use kcmc::websocket::BatchResponse;
    use kcmc::websocket::ModelingBatch;
    use kcmc::websocket::ModelingCmdReq;
    use kcmc::websocket::OkWebSocketResponseData;
    use kcmc::websocket::SuccessWebSocketResponse;
    use kcmc::websocket::WebSocketRequest;
    use kcmc::websocket::WebSocketResponse;
    use kittycad_modeling_cmds as kcmc;
    use kittycad_modeling_cmds::ImportFiles;
    use kittycad_modeling_cmds::ModelingCmd;
    use uuid::Uuid;

    use super::EngineTransport;
    use super::TransportCloseError;
    use crate::SourceRange;
    use crate::errors::KclError;

    /// Doesn't actually connect to the engine.
    pub struct MockTransport;

    impl MockTransport {
        pub fn new() -> Self {
            Self
        }
    }

    #[async_trait::async_trait]
    impl EngineTransport for MockTransport {
        async fn inner_fire_modeling_cmd(
            &self,
            _cmd_id: Uuid,
            _source_range: SourceRange,
            _cmd: WebSocketRequest,
            _id_to_source_range: HashMap<Uuid, SourceRange>,
        ) -> Result<(), KclError> {
            Ok(())
        }

        async fn inner_send_modeling_cmd(
            &self,
            id: Uuid,
            _source_range: SourceRange,
            cmd: WebSocketRequest,
            _id_to_source_range: HashMap<Uuid, SourceRange>,
        ) -> Result<WebSocketResponse, KclError> {
            let response = match cmd {
                WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
                    ref requests,
                    batch_id: _,
                    responses: _,
                }) => {
                    let mut responses = HashMap::with_capacity(requests.len());
                    for request in requests {
                        responses.insert(
                            request.cmd_id,
                            BatchResponse::Success {
                                response: OkModelingCmdResponse::Empty {},
                            },
                        );
                    }
                    WebSocketResponse::Success(SuccessWebSocketResponse {
                        request_id: Some(id),
                        resp: OkWebSocketResponseData::ModelingBatch { responses },
                        success: true,
                    })
                }
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                    cmd: ModelingCmd::ImportFiles(ImportFiles { .. }),
                    cmd_id,
                }) => WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::Modeling {
                        modeling_response: OkModelingCmdResponse::ImportFiles(
                            kittycad_modeling_cmds::output::ImportFiles::builder()
                                .object_id(cmd_id.into())
                                .build(),
                        ),
                    },
                    success: true,
                }),
                WebSocketRequest::ModelingCmdReq(_) => WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::Modeling {
                        modeling_response: OkModelingCmdResponse::Empty {},
                    },
                    success: true,
                }),
                _ => WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::Modeling {
                        modeling_response: OkModelingCmdResponse::Empty {},
                    },
                    success: true,
                }),
            };

            Ok(response)
        }

        async fn close(&self) -> Result<(), TransportCloseError> {
            Ok(())
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub mod wasm_transport {
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
}

#[cfg(not(target_arch = "wasm32"))]
pub mod ws_transport {
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::time::Duration;
    use std::time::Instant;

    use anyhow::anyhow;
    use futures::SinkExt;
    use futures::StreamExt;
    use kcmc::ModelingCmd;
    use kcmc::websocket::BatchResponse;
    use kcmc::websocket::FailureWebSocketResponse;
    use kcmc::websocket::ModelingCmdReq;
    use kcmc::websocket::ModelingSessionData;
    use kcmc::websocket::OkWebSocketResponseData;
    use kcmc::websocket::SuccessWebSocketResponse;
    use kcmc::websocket::WebSocketRequest;
    use kcmc::websocket::WebSocketResponse;
    use kittycad_modeling_cmds::{self as kcmc};
    use tokio::sync::RwLock;
    use tokio::sync::mpsc;
    use tokio::sync::oneshot;
    use tokio_tungstenite::tungstenite::Message as WsMsg;
    use uuid::Uuid;

    use super::EngineTransport;
    use super::ResponseInformation;
    use super::SocketHealth;
    use super::TransportCloseError;
    use crate::SourceRange;
    use crate::errors::KclError;
    use crate::errors::KclErrorDetails;
    use crate::log::logln;

    pub struct TcpRead {
        stream: futures::stream::SplitStream<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>>,
    }

    impl TcpRead {
        pub async fn read(&mut self) -> std::result::Result<WebSocketResponse, WebSocketReadError> {
            let Some(msg) = self.stream.next().await else {
                return Err(anyhow!("Failed to read from WebSocket").into());
            };
            let msg = match msg {
                Ok(msg) => msg,
                Err(e) if matches!(e, tokio_tungstenite::tungstenite::Error::Protocol(_)) => {
                    return Err(WebSocketReadError::Read(e));
                }
                Err(e) => return Err(anyhow!("Error reading from engine's WebSocket: {e}").into()),
            };
            let msg: WebSocketResponse = match msg {
                WsMsg::Text(text) => serde_json::from_str(&text)
                    .map_err(anyhow::Error::from)
                    .map_err(WebSocketReadError::from)?,
                WsMsg::Binary(bin) => rmp_serde::from_slice(&bin)
                    .map_err(anyhow::Error::from)
                    .map_err(WebSocketReadError::from)?,
                other => return Err(anyhow!("Unexpected WebSocket message from engine API: {other}").into()),
            };
            Ok(msg)
        }
    }

    type WebSocketTcpWrite = futures::stream::SplitSink<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>, WsMsg>;

    /// Sends requests to the engine over its Modeling API WebSocket.
    /// Used on native platforms, does not work in browser WASM sandbox.
    pub struct WebSocketTransport {
        _tcp_read_handle: Arc<TcpReadHandle>,
        engine_req_tx: mpsc::Sender<ToEngineReq>,
        shutdown_tx: mpsc::Sender<()>,
        responses: ResponseInformation,
        pending_errors: Arc<RwLock<Vec<String>>>,
        session_data: Arc<RwLock<Option<ModelingSessionData>>>,
        socket_health: Arc<RwLock<SocketHealth>>,
    }

    pub struct TcpReadHandle {
        handle: Arc<tokio::task::JoinHandle<Result<(), WebSocketReadError>>>,
    }

    impl Drop for TcpReadHandle {
        fn drop(&mut self) {
            self.handle.abort();
        }
    }

    /// Occurs when client couldn't read from the WebSocket to the engine.
    #[allow(clippy::large_enum_variant)]
    pub enum WebSocketReadError {
        /// Could not read a message due to WebSocket errors.
        Read(tokio_tungstenite::tungstenite::Error),
        /// WebSocket message didn't contain a valid message that the KCL Executor could parse.
        Deser(anyhow::Error),
    }

    impl From<anyhow::Error> for WebSocketReadError {
        fn from(e: anyhow::Error) -> Self {
            Self::Deser(e)
        }
    }

    /// Requests to send to the engine, and a way to await a response.
    struct ToEngineReq {
        /// The request to send
        req: WebSocketRequest,
        /// If this resolves to Ok, the request was sent.
        /// If this resolves to Err, the request could not be sent.
        /// If this has not yet resolved, the request has not been sent yet.
        request_sent: oneshot::Sender<anyhow::Result<()>>,
    }

    impl WebSocketTransport {
        /// Start a long-lived actor that reads from
        pub async fn spawn(
            // Passed via UnifiedConnection from elsewhere
            ws: reqwest::Upgraded,
            heartbeats: Option<u64>,

            // Created by UnifiedConnection
            response_information: ResponseInformation,
            shutdown_tx: mpsc::Sender<()>,
            session_data: Arc<RwLock<Option<ModelingSessionData>>>,
            pending_errors: Arc<RwLock<Vec<String>>>,
            socket_health: Arc<RwLock<SocketHealth>>,
            shutdown_rx: mpsc::Receiver<()>,
        ) -> Self {
            let wsconfig = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                // 4294967296 bytes, which is around 4.2 GB.
                .max_message_size(Some(usize::MAX))
                .max_frame_size(Some(usize::MAX));

            let ws_stream = tokio_tungstenite::WebSocketStream::from_raw_socket(
                ws,
                tokio_tungstenite::tungstenite::protocol::Role::Client,
                Some(wsconfig),
            )
            .await;

            let (tcp_write, tcp_read) = ws_stream.split();
            let (engine_req_tx, engine_req_rx) = mpsc::channel(10);
            tokio::task::spawn(Self::start_write_actor(
                tcp_write,
                engine_req_rx,
                shutdown_rx,
                heartbeats,
            ));

            let mut tcp_read = TcpRead { stream: tcp_read };

            let response_information_for_read = response_information.clone();
            let session_data_for_read = session_data.clone();
            let pending_errors_for_read = pending_errors.clone();
            let socket_health_tcp_read = socket_health.clone();
            let tcp_read_handle = tokio::spawn(async move {
                // Get Websocket messages from API server
                loop {
                    match tcp_read.read().await {
                        Ok(ws_resp) => {
                            // If we got a batch response, add all the inner responses.
                            let id = ws_resp.request_id();
                            match &ws_resp {
                                WebSocketResponse::Success(SuccessWebSocketResponse {
                                    resp: OkWebSocketResponseData::ModelingBatch { responses },
                                    ..
                                }) => {
                                    #[expect(
                                        clippy::iter_over_hash_type,
                                        reason = "modeling command uses a HashMap and keys are random, so we don't really have a choice"
                                    )]
                                    for (resp_id, batch_response) in responses {
                                        let id: uuid::Uuid = (*resp_id).into();
                                        match batch_response {
                                            BatchResponse::Success { response } => {
                                                // If the id is in our ids of async commands, remove
                                                // it.
                                                response_information_for_read
                                                    .add(
                                                        id,
                                                        WebSocketResponse::Success(SuccessWebSocketResponse {
                                                            success: true,
                                                            request_id: Some(id),
                                                            resp: OkWebSocketResponseData::Modeling {
                                                                modeling_response: response.clone(),
                                                            },
                                                        }),
                                                    )
                                                    .await;
                                            }
                                            BatchResponse::Failure { errors } => {
                                                response_information_for_read
                                                    .add(
                                                        id,
                                                        WebSocketResponse::Failure(FailureWebSocketResponse {
                                                            success: false,
                                                            request_id: Some(id),
                                                            errors: errors.clone(),
                                                        }),
                                                    )
                                                    .await;
                                            }
                                        }
                                    }
                                }
                                WebSocketResponse::Success(SuccessWebSocketResponse {
                                    resp: OkWebSocketResponseData::ModelingSessionData { session },
                                    ..
                                }) => {
                                    let mut sd = session_data_for_read.write().await;
                                    sd.replace(session.clone());
                                    logln!("API Call ID: {}", session.api_call_id);
                                }
                                WebSocketResponse::Failure(FailureWebSocketResponse {
                                    success: _,
                                    request_id,
                                    errors,
                                }) => {
                                    if let Some(id) = request_id {
                                        response_information_for_read
                                            .add(
                                                *id,
                                                WebSocketResponse::Failure(FailureWebSocketResponse {
                                                    success: false,
                                                    request_id: *request_id,
                                                    errors: errors.clone(),
                                                }),
                                            )
                                            .await;
                                    } else {
                                        // Add it to our pending errors.
                                        let mut pe = pending_errors_for_read.write().await;
                                        for error in errors {
                                            if !pe.contains(&error.message) {
                                                pe.push(error.message.clone());
                                            }
                                        }
                                        drop(pe);
                                    }
                                }
                                WebSocketResponse::Success(SuccessWebSocketResponse {
                                    resp: _debug @ OkWebSocketResponseData::Debug { .. },
                                    ..
                                }) => {
                                    // Deletd, I don't think this was ever used.
                                }
                                _ => {}
                            }

                            if let Some(id) = id {
                                response_information_for_read.add(id, ws_resp.clone()).await;
                            }
                        }
                        Err(e) => {
                            match &e {
                                WebSocketReadError::Read(e) => crate::logln!("could not read from WS: {:?}", e),
                                WebSocketReadError::Deser(e) => {
                                    crate::logln!("could not deserialize msg from WS: {:?}", e)
                                }
                            }
                            *socket_health_tcp_read.write().await = SocketHealth::Inactive;
                            return Err(e);
                        }
                    }
                }
            });
            Self {
                shutdown_tx,
                responses: response_information,
                pending_errors,
                session_data,
                socket_health,
                engine_req_tx,
                _tcp_read_handle: Arc::new(TcpReadHandle {
                    handle: Arc::new(tcp_read_handle),
                }),
            }
        }

        async fn inner_send_to_engine_binary(
            request: WebSocketRequest,
            tcp_write: &mut WebSocketTcpWrite,
        ) -> anyhow::Result<()> {
            let msg = rmp_serde::to_vec_named(&request).map_err(|e| anyhow!("could not serialize msgpack: {e}"))?;
            tcp_write
                .send(WsMsg::Binary(msg.into()))
                .await
                .map_err(|e| anyhow!("could not send MsgPack over websocket: {e}"))?;
            Ok(())
        }

        /// Send the given `request` to the engine via the WebSocket connection `tcp_write`.
        async fn inner_send_to_engine(
            request: WebSocketRequest,
            tcp_write: &mut WebSocketTcpWrite,
        ) -> anyhow::Result<()> {
            let msg = serde_json::to_string(&request).map_err(|e| anyhow!("could not serialize json: {e}"))?;
            tcp_write
                .send(WsMsg::Text(msg.into()))
                .await
                .map_err(|e| anyhow!("could not send json over websocket: {e}"))?;
            Ok(())
        }

        async fn start_write_actor(
            mut tcp_write: WebSocketTcpWrite,
            mut engine_req_rx: mpsc::Receiver<ToEngineReq>,
            mut shutdown_rx: mpsc::Receiver<()>,
            heartbeats: Option<u64>,
        ) {
            let heartbeats = heartbeats.unwrap_or_default();
            let send_heartbeats = heartbeats != 0;
            let period_seconds = if heartbeats == 0 { 5 * 60 } else { heartbeats };
            let period = Duration::from_secs(period_seconds);
            let mut heartbeats_stream = tokio::time::interval(period);

            loop {
                tokio::select! {
                    maybe_req = engine_req_rx.recv() => {
                        match maybe_req {
                            Some(ToEngineReq { req, request_sent }) => {
                                // Decide whether to send as binary or text,
                                // then send to the engine.
                                let res = if let WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                                    cmd: ModelingCmd::ImportFiles { .. },
                                    cmd_id: _,
                                }) = &req
                                {
                                    Self::inner_send_to_engine_binary(req, &mut tcp_write).await
                                } else {
                                    Self::inner_send_to_engine(req, &mut tcp_write).await
                                };

                                // Let the caller know we’ve sent the request (ok or error).
                                let _ = request_sent.send(res);
                            }
                            None => {
                                // The engine_req_rx channel has closed, so no more requests.
                                // We'll gracefully exit the loop and close the engine.
                                break;
                            }
                        }
                    },

                    // If we get a shutdown signal, close the engine immediately and return.
                    _ = shutdown_rx.recv() => {
                        let _ = Self::inner_close_engine(&mut tcp_write).await;
                        return;
                    }

                    // Send heartbeats periodically.
                    _ = heartbeats_stream.tick(), if send_heartbeats => {
                        // Send a heartbeat.
                        let res = Self::inner_send_to_engine(WebSocketRequest::Ping {}, &mut tcp_write).await;
                        // We don't really care if a heartbeat fails, we'll just try again soon.
                        let _ = res;
                    }
                }
            }

            // If we exit the loop (e.g. engine_req_rx was closed),
            // still gracefully close the engine before returning.
            let _ = Self::inner_close_engine(&mut tcp_write).await;
        }

        /// Send the given `request` to the engine via the WebSocket connection `tcp_write`.
        async fn inner_close_engine(tcp_write: &mut WebSocketTcpWrite) -> anyhow::Result<()> {
            tcp_write
                .send(WsMsg::Close(None))
                .await
                .map_err(|e| anyhow!("could not send close over websocket: {e}"))?;
            Ok(())
        }
    }

    #[async_trait::async_trait]
    impl EngineTransport for WebSocketTransport {
        async fn inner_fire_modeling_cmd(
            &self,
            _cmd_id: uuid::Uuid,
            source_range: SourceRange,
            cmd: WebSocketRequest,
            _id_to_source_range: HashMap<Uuid, SourceRange>,
        ) -> Result<(), KclError> {
            let (tx, rx) = oneshot::channel();

            // Send the request to the engine, via the actor.
            self.engine_req_tx
                .send(ToEngineReq {
                    req: cmd.clone(),
                    request_sent: tx,
                })
                .await
                .map_err(|e| {
                    KclError::new_engine(KclErrorDetails::new(
                        format!("Failed to send modeling command: {e}"),
                        vec![source_range],
                    ))
                })?;

            // Wait for the request to be sent.
            rx.await
                .map_err(|e| {
                    KclError::new_engine_hangup(
                        KclErrorDetails::new(
                            format!("could not send request to the engine actor: {e}"),
                            vec![source_range],
                        ),
                        None,
                    )
                })?
                .map_err(|e| {
                    KclError::new_engine_hangup(
                        KclErrorDetails::new(format!("could not send request to the engine: {e}"), vec![source_range]),
                        None,
                    )
                })?;

            Ok(())
        }

        async fn inner_send_modeling_cmd(
            &self,
            cmd_id: uuid::Uuid,
            source_range: SourceRange,
            cmd: WebSocketRequest,
            id_to_source_range: HashMap<Uuid, SourceRange>,
        ) -> Result<WebSocketResponse, KclError> {
            self.inner_fire_modeling_cmd(cmd_id, source_range, cmd, id_to_source_range)
                .await?;

            let response_timeout = 600;
            let current_time = Instant::now();
            while current_time.elapsed().as_secs() < response_timeout {
                let guard = self.socket_health.read().await;
                if *guard == SocketHealth::Inactive {
                    let session_data = self.session_data.read().await;
                    let api_call_id = session_data.as_ref().map(|session| session.api_call_id.to_string());
                    let api_call_id_msg = if let Some(ref id) = api_call_id {
                        format!(" (API call ID: {})", id)
                    } else {
                        String::new()
                    };

                    let pe = self.pending_errors.read().await;
                    if !pe.is_empty() {
                        return Err(KclError::new_engine(KclErrorDetails::new(
                            format!("{}{}", pe.join(", "), api_call_id_msg),
                            vec![source_range],
                        )));
                    } else {
                        return Err(KclError::new_engine_hangup(
                            KclErrorDetails::new(
                                format!("Modeling command failed: websocket closed early{}", api_call_id_msg),
                                vec![source_range],
                            ),
                            api_call_id,
                        ));
                    }
                }

                if let Some(resp) = self.responses.responses.read().await.get(&cmd_id) {
                    return Ok(resp.clone());
                }
            }

            let session_data = self.session_data.read().await;
            let api_call_id_msg = if let Some(session) = session_data.as_ref() {
                format!(" (API call ID: {})", session.api_call_id)
            } else {
                String::new()
            };

            Err(KclError::new_engine(KclErrorDetails::new(
                format!("Modeling command timed out `{cmd_id}`{}", api_call_id_msg),
                vec![source_range],
            )))
        }

        async fn close(&self) -> Result<(), TransportCloseError> {
            let _ = self.shutdown_tx.send(()).await;
            loop {
                let guard = self.socket_health.read().await;
                if *guard == SocketHealth::Inactive {
                    return Ok(());
                }
            }
        }
    }
}

/// Information about the responses from the engine.
#[derive(Clone, Debug)]
pub struct ResponseInformation {
    /// The responses from the engine.
    responses: Arc<RwLock<IndexMap<uuid::Uuid, WebSocketResponse>>>,
}

impl ResponseInformation {
    /// Basic constructor.
    pub fn new(responses: Arc<RwLock<IndexMap<uuid::Uuid, WebSocketResponse>>>) -> Self {
        Self { responses }
    }

    /// Add a new response from the engine.
    pub async fn add(&self, id: Uuid, response: WebSocketResponse) {
        self.responses.write().await.insert(id, response);
    }
}

#[derive(bon::Builder)]
pub struct UnifiedConnection {
    // Replaces `engine_req_tx: mpsc::Sender<ToEngineReq>`
    // from the original native connection type.
    transport: Arc<Box<dyn EngineTransport>>,
    responses: ResponseInformation,
    pending_errors: Arc<RwLock<Vec<String>>>,
    socket_health: Arc<RwLock<SocketHealth>>,
    ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>>,

    /// The default planes for the scene.
    #[builder(default)]
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    /// If the server sends session data, it'll be copied to here.
    session_data: Arc<RwLock<Option<ModelingSessionData>>>,

    #[builder(default)]
    stats: EngineStats,

    #[builder(default)]
    async_tasks: AsyncTasks,
}

impl std::fmt::Debug for UnifiedConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UnifiedConnection")
            .field("responses", &self.responses)
            .field("pending_errors", &self.pending_errors)
            .field("socket_health", &self.socket_health)
            .field("ids_of_async_commands", &self.ids_of_async_commands)
            .field("default_planes", &self.default_planes)
            .field("session_data", &self.session_data)
            .field("stats", &self.stats)
            .field("async_tasks", &self.async_tasks)
            .finish()
    }
}

impl UnifiedConnection {
    #[cfg(target_arch = "wasm32")]
    pub fn new_wasm_transport(
        manager: wasm_transport::EngineCommandManager,
        response_context: Arc<wasm_transport::ResponseContext>,
    ) -> Self {
        let session_data: Arc<RwLock<Option<ModelingSessionData>>> = Arc::new(RwLock::new(None));
        let ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>> = Arc::new(RwLock::new(IndexMap::new()));
        let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
        let pending_errors = Arc::new(RwLock::new(Vec::new()));
        let responses = response_context.response_information();

        Self {
            transport: Arc::new(Box::new(wasm_transport::WasmTransport::new(manager))),
            responses,
            pending_errors,
            socket_health,
            ids_of_async_commands,
            default_planes: Default::default(),
            session_data,
            stats: Default::default(),
            async_tasks: Default::default(),
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new_websocket_transport(ws: reqwest::Upgraded, heartbeats: Option<u64>) -> Self {
        use crate::engine::conn_unified::ws_transport::WebSocketTransport;

        let session_data: Arc<RwLock<Option<ModelingSessionData>>> = Arc::new(RwLock::new(None));
        let ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>> = Arc::new(RwLock::new(IndexMap::new()));
        let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
        let pending_errors = Arc::new(RwLock::new(Vec::new()));
        let responses = ResponseInformation {
            responses: Arc::new(RwLock::new(IndexMap::new())),
        };
        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

        let transport = WebSocketTransport::spawn(
            ws,
            heartbeats,
            responses.clone(),
            shutdown_tx.clone(),
            Arc::clone(&session_data),
            Arc::clone(&pending_errors),
            Arc::clone(&socket_health),
            shutdown_rx,
        )
        .await;

        Self {
            transport: Arc::new(Box::new(transport)),
            responses,
            pending_errors,
            socket_health,
            ids_of_async_commands,
            default_planes: Default::default(),
            session_data,
            stats: Default::default(),
            async_tasks: Default::default(),
        }
    }

    /// Mock connection that doesn't actually connect to anything.
    /// Used for testing.
    pub fn new_mock() -> Self {
        let session_data: Arc<RwLock<Option<ModelingSessionData>>> = Arc::new(RwLock::new(None));
        let ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>> = Arc::new(RwLock::new(IndexMap::new()));
        let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
        let pending_errors = Arc::new(RwLock::new(Vec::new()));
        let responses = ResponseInformation {
            responses: Arc::new(RwLock::new(IndexMap::new())),
        };
        Self {
            transport: Arc::new(Box::new(mock_transport::MockTransport::new())),
            responses,
            pending_errors,
            socket_health,
            ids_of_async_commands,
            default_planes: Default::default(),
            session_data,
            stats: Default::default(),
            async_tasks: Default::default(),
        }
    }

    /// Take the ids of async commands that have accumulated so far and clear them.
    async fn take_ids_of_async_commands(&self) -> IndexMap<Uuid, SourceRange> {
        std::mem::take(&mut *self.ids_of_async_commands().write().await)
    }

    /// Take the responses that have accumulated so far and clear them.
    pub async fn take_responses(&self) -> IndexMap<Uuid, WebSocketResponse> {
        std::mem::take(&mut *self.responses().write().await)
    }

    pub async fn clear_scene(
        &self,
        batch_context: &EngineBatchContext,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<(), crate::errors::KclError> {
        // Clear any batched commands leftover from previous scenes.
        self.clear_queues(batch_context).await;

        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::SceneClearAll(mcmd::SceneClearAll::default()),
        )
        .await?;

        // Flush the batch queue, so clear is run right away.
        // Otherwise the hooks below won't work.
        self.flush_batch(batch_context, false, source_range).await?;

        // Do the after clear scene hook.
        self.clear_scene_post_hook(batch_context, id_generator, source_range)
            .await?;

        Ok(())
    }

    /// Ensure a specific async command has been completed.
    pub async fn ensure_async_command_completed(
        &self,
        id: uuid::Uuid,
        source_range: Option<SourceRange>,
    ) -> Result<OkWebSocketResponseData, KclError> {
        let source_range = if let Some(source_range) = source_range {
            source_range
        } else {
            // Look it up if we don't have it.
            self.ids_of_async_commands()
                .read()
                .await
                .get(&id)
                .cloned()
                .unwrap_or_default()
        };

        // The previous 60s ceiling here was too aggressive for long-running
        // engine commands - notably large STEP / B-rep imports, which the
        // engine itself routinely takes several minutes to process. When the
        // ceiling fired first the user got a generic "async command timed
        // out" message and the eventual engine response (success OR error)
        // was discarded, masking the real outcome. 600s (10 min) gives the
        // engine room to finish or to surface its own error.
        const ASYNC_CMD_TIMEOUT_SECS: u64 = 600;
        let current_time = Instant::now();
        while current_time.elapsed().as_secs() < ASYNC_CMD_TIMEOUT_SECS {
            let responses = self.responses().read().await.clone();
            let Some(resp) = responses.get(&id) else {
                // Yield to the event loop so that we don’t block the UI thread.
                // No seriously WE DO NOT WANT TO PAUSE THE WHOLE APP ON THE JS SIDE.
                #[cfg(target_arch = "wasm32")]
                {
                    let duration = web_time::Duration::from_millis(1);
                    wasm_timer::Delay::new(duration).await.map_err(|err| {
                        KclError::new_internal(KclErrorDetails::new(
                            format!("Failed to sleep: {:?}", err),
                            vec![source_range],
                        ))
                    })?;
                }
                #[cfg(not(target_arch = "wasm32"))]
                tokio::task::yield_now().await;
                continue;
            };

            // If the response is an error, return it.
            // Parsing will do that and we can ignore the result, we don't care.
            let response = self.parse_websocket_response(resp.clone(), source_range)?;
            return Ok(response);
        }

        Err(KclError::new_engine(KclErrorDetails::new(
            format!(
                "async command timed out after {ASYNC_CMD_TIMEOUT_SECS}s (client-side ceiling, not an engine error)"
            ),
            vec![source_range],
        )))
    }

    /// Ensure ALL async commands have been completed.
    pub async fn ensure_async_commands_completed(&self, batch_context: &EngineBatchContext) -> Result<(), KclError> {
        // Check if all async commands have been completed.
        let ids = self.take_ids_of_async_commands().await;

        // Try to get them from the responses.
        for (id, source_range) in ids {
            self.ensure_async_command_completed(id, Some(source_range)).await?;
        }

        // Make sure we check for all async tasks as well.
        // The reason why we ignore the error here is that, if a model fillets an edge
        // we previously called something on, it might no longer exist. In which case,
        // the artifact graph won't care either if its gone since you can't select it
        // anymore anyways.
        if let Err(err) = self.async_tasks().join_all().await {
            crate::log::logln!(
                "Error waiting for async tasks (this is typically fine and just means that an edge became something else): {:?}",
                err
            );
        }

        // Flush the batch to make sure nothing remains.
        self.flush_batch(batch_context, true, SourceRange::default()).await?;

        Ok(())
    }

    /// Set the visibility of edges.
    async fn set_edge_visibility(
        &self,
        batch_context: &EngineBatchContext,
        visible: bool,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
    ) -> Result<(), crate::errors::KclError> {
        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::from(mcmd::EdgeLinesVisible::builder().hidden(!visible).build()),
        )
        .await?;

        Ok(())
    }

    /// Re-run the command to apply the settings.
    pub async fn reapply_settings(
        &self,
        batch_context: &EngineBatchContext,
        settings: &crate::ExecutorSettings,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
        grid_scale_unit: GridScaleBehavior,
    ) -> Result<(), crate::errors::KclError> {
        // Set the edge visibility.
        self.set_edge_visibility(batch_context, settings.highlight_edges, source_range, id_generator)
            .await?;

        // Send the command to show the grid.

        self.modify_grid(
            batch_context,
            !settings.show_grid,
            grid_scale_unit,
            source_range,
            id_generator,
        )
        .await?;

        // Set up user's color choices.
        self.set_user_colors(batch_context, settings, source_range, id_generator)
            .await?;

        // We do not have commands for changing ssao on the fly.

        // Flush the batch queue, so the settings are applied right away.
        self.flush_batch(batch_context, false, source_range).await?;

        Ok(())
    }

    // Add a modeling command to the batch but don't fire it right away.
    pub async fn batch_modeling_cmd(
        &self,
        batch_context: &EngineBatchContext,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        let req = WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id.into(),
        });

        // Add cmd to the batch.
        batch_context.push(req, source_range).await;
        self.stats().commands_batched.fetch_add(1, Relaxed);

        Ok(())
    }

    // Add a vector of modeling commands to the batch but don't fire it right away.
    // This allows you to force them all to be added together in the same order.
    // When we are running things in parallel this prevents race conditions that might come
    // if specific commands are run before others.
    pub async fn batch_modeling_cmds(
        &self,
        batch_context: &EngineBatchContext,
        source_range: SourceRange,
        cmds: &[ModelingCmdReq],
    ) -> Result<(), crate::errors::KclError> {
        // Add cmds to the batch.
        let mut extended_cmds = Vec::with_capacity(cmds.len());
        for cmd in cmds {
            extended_cmds.push((WebSocketRequest::ModelingCmdReq(cmd.clone()), source_range));
        }
        self.stats().commands_batched.fetch_add(extended_cmds.len(), Relaxed);
        batch_context.extend(extended_cmds).await;

        Ok(())
    }

    /// Add a command to the batch that needs to be executed at the very end.
    /// This for stuff like fillets or chamfers where if we execute too soon the
    /// engine will eat the ID and we can't reference it for other commands.
    pub async fn batch_end_cmd(
        &self,
        batch_context: &EngineBatchContext,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        let req = WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id.into(),
        });

        // Add cmd to the batch end.
        batch_context.insert_end(id, req, source_range).await;
        self.stats().commands_batched.fetch_add(1, Relaxed);
        Ok(())
    }

    /// Send the modeling cmd and wait for the response.
    pub async fn send_modeling_cmd(
        &self,
        batch_context: &EngineBatchContext,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        let mut requests = batch_context.take_batch().await;

        // Add the command to the batch.
        requests.push((
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                cmd: cmd.clone(),
                cmd_id: id.into(),
            }),
            source_range,
        ));
        self.stats().commands_batched.fetch_add(1, Relaxed);

        // Flush the batch queue.
        self.run_batch(requests, source_range).await
    }

    /// Send the modeling cmd async and don't wait for the response.
    /// Add it to our list of async commands.
    pub async fn async_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        // Add the command ID to the list of async commands.
        self.ids_of_async_commands().write().await.insert(id, source_range);

        // Fire off the command now, but don't wait for the response, we don't care about it.
        self.transport
            .inner_fire_modeling_cmd(
                id,
                source_range,
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                    cmd: cmd.clone(),
                    cmd_id: id.into(),
                }),
                HashMap::from([(id, source_range)]),
            )
            .await?;

        Ok(())
    }

    /// Run the batch for the specific commands.
    async fn run_batch(
        &self,
        orig_requests: Vec<(WebSocketRequest, SourceRange)>,
        source_range: SourceRange,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        // Return early if we have no commands to send.
        if orig_requests.is_empty() {
            return Ok(OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::Empty {},
            });
        }

        let requests: Vec<ModelingCmdReq> = orig_requests
            .iter()
            .filter_map(|(val, _)| match val {
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq { cmd, cmd_id }) => Some(ModelingCmdReq {
                    cmd: cmd.clone(),
                    cmd_id: *cmd_id,
                }),
                _ => None,
            })
            .collect();

        let batched_requests = WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
            requests,
            batch_id: uuid::Uuid::new_v4().into(),
            responses: true,
        });

        let final_req = if orig_requests.len() == 1 {
            // We can unwrap here because we know the batch has only one element.
            orig_requests.first().unwrap().0.clone()
        } else {
            batched_requests
        };

        // Create the map of original command IDs to source range.
        // This is for the wasm side, kurt needs it for selections.
        let mut id_to_source_range = HashMap::new();
        for (req, range) in orig_requests.iter() {
            match req {
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq { cmd: _, cmd_id }) => {
                    id_to_source_range.insert(Uuid::from(*cmd_id), *range);
                }
                _ => {
                    return Err(KclError::new_engine(KclErrorDetails::new(
                        format!("The request is not a modeling command: {req:?}"),
                        vec![*range],
                    )));
                }
            }
        }

        self.stats().batches_sent.fetch_add(1, Relaxed);

        // We pop off the responses to cleanup our mappings.
        match final_req {
            WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
                ref requests,
                batch_id,
                responses: _,
            }) => {
                // Get the last command ID.
                let last_id = requests.last().unwrap().cmd_id;
                let ws_resp = self
                    .inner_send_modeling_cmd(batch_id.into(), source_range, final_req, id_to_source_range.clone())
                    .await?;
                let response = self.parse_websocket_response(ws_resp, source_range)?;

                // If we have a batch response, we want to return the specific id we care about.
                if let OkWebSocketResponseData::ModelingBatch { responses } = response {
                    let responses = responses.into_iter().map(|(k, v)| (Uuid::from(k), v)).collect();
                    self.parse_batch_responses(last_id.into(), id_to_source_range, responses)
                } else {
                    // We should never get here.
                    Err(KclError::new_engine(KclErrorDetails::new(
                        format!("Failed to get batch response: {response:?}"),
                        vec![source_range],
                    )))
                }
            }
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq { cmd: _, cmd_id }) => {
                // You are probably wondering why we can't just return the source range we were
                // passed with the function. Well this is actually really important.
                // If this is the last command in the batch and there is only one and we've reached
                // the end of the file, this will trigger a flush batch function, but it will just
                // send default or the end of the file as it's source range not the origin of the
                // request so we need the original request source range in case the engine returns
                // an error.
                let source_range = id_to_source_range.get(cmd_id.as_ref()).cloned().ok_or_else(|| {
                    KclError::new_engine(KclErrorDetails::new(
                        format!("Failed to get source range for command ID: {cmd_id:?}"),
                        vec![],
                    ))
                })?;
                let ws_resp = self
                    .inner_send_modeling_cmd(cmd_id.into(), source_range, final_req, id_to_source_range)
                    .await?;
                self.parse_websocket_response(ws_resp, source_range)
            }
            _ => Err(KclError::new_engine(KclErrorDetails::new(
                format!("The final request is not a modeling command: {final_req:?}"),
                vec![source_range],
            ))),
        }
    }

    /// Force flush the batch queue.
    pub async fn flush_batch(
        &self,
        batch_context: &EngineBatchContext,
        // Whether or not to flush the end commands as well.
        // We only do this at the very end of the file.
        batch_end: bool,
        source_range: SourceRange,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        let all_requests = if batch_end {
            let mut requests = batch_context.take_batch().await;
            requests.extend(batch_context.take_batch_end().await.values().cloned());
            requests
        } else {
            batch_context.take_batch().await
        };

        self.run_batch(all_requests, source_range).await
    }

    async fn make_default_plane(
        &self,
        batch_context: &EngineBatchContext,
        plane_id: uuid::Uuid,
        info: &PlaneInfo,
        color: Option<Color>,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
    ) -> Result<uuid::Uuid, KclError> {
        // Create new default planes.
        let default_size = 100.0;

        self.batch_modeling_cmd(
            batch_context,
            plane_id,
            source_range,
            &ModelingCmd::from(
                mcmd::MakePlane::builder()
                    .clobber(false)
                    .origin(info.origin.into())
                    .size(LengthUnit(default_size))
                    .x_axis(info.x_axis.into())
                    .y_axis(info.y_axis.into())
                    .hide(true)
                    .build(),
            ),
        )
        .await?;

        if let Some(color) = color {
            // Set the color.
            self.batch_modeling_cmd(
                batch_context,
                id_generator.next_uuid(),
                source_range,
                &ModelingCmd::from(mcmd::PlaneSetColor::builder().color(color).plane_id(plane_id).build()),
            )
            .await?;
        }

        Ok(plane_id)
    }

    async fn new_default_planes(
        &self,
        batch_context: &EngineBatchContext,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<DefaultPlanes, KclError> {
        let plane_opacity = 0.1;
        let plane_settings: Vec<(PlaneName, Uuid, Option<Color>)> = vec![
            (
                PlaneName::Xy,
                id_generator.next_uuid(),
                Some(Color::from_rgba(0.7, 0.28, 0.28, plane_opacity)),
            ),
            (
                PlaneName::Yz,
                id_generator.next_uuid(),
                Some(Color::from_rgba(0.28, 0.7, 0.28, plane_opacity)),
            ),
            (
                PlaneName::Xz,
                id_generator.next_uuid(),
                Some(Color::from_rgba(0.28, 0.28, 0.7, plane_opacity)),
            ),
            (PlaneName::NegXy, id_generator.next_uuid(), None),
            (PlaneName::NegYz, id_generator.next_uuid(), None),
            (PlaneName::NegXz, id_generator.next_uuid(), None),
        ];

        let mut planes = HashMap::new();
        for (name, plane_id, color) in plane_settings {
            let info = DEFAULT_PLANE_INFO.get(&name).ok_or_else(|| {
                // We should never get here.
                KclError::new_engine(KclErrorDetails::new(
                    format!("Failed to get default plane info for: {name:?}"),
                    vec![source_range],
                ))
            })?;
            planes.insert(
                name,
                self.make_default_plane(batch_context, plane_id, info, color, source_range, id_generator)
                    .await?,
            );
        }

        // Flush the batch queue, so these planes are created right away.
        self.flush_batch(batch_context, false, source_range).await?;

        Ok(DefaultPlanes {
            xy: planes[&PlaneName::Xy],
            neg_xy: planes[&PlaneName::NegXy],
            xz: planes[&PlaneName::Xz],
            neg_xz: planes[&PlaneName::NegXz],
            yz: planes[&PlaneName::Yz],
            neg_yz: planes[&PlaneName::NegYz],
        })
    }

    fn parse_websocket_response(
        &self,
        response: WebSocketResponse,
        source_range: SourceRange,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        match response {
            WebSocketResponse::Success(success) => Ok(success.resp),
            WebSocketResponse::Failure(fail) => {
                let _request_id = fail.request_id;
                if fail.errors.is_empty() {
                    return Err(KclError::new_engine(KclErrorDetails::new(
                        "Failure response with no error details".to_owned(),
                        vec![source_range],
                    )));
                }
                Err(KclError::new_engine(KclErrorDetails::new(
                    fail.errors
                        .iter()
                        .map(|e| e.message.clone())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    vec![source_range],
                )))
            }
        }
    }

    fn parse_batch_responses(
        &self,
        // The last response we are looking for.
        id: uuid::Uuid,
        // The mapping of source ranges to command IDs.
        id_to_source_range: HashMap<uuid::Uuid, SourceRange>,
        // The response from the engine.
        responses: HashMap<uuid::Uuid, BatchResponse>,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        // Iterate over the responses and check for errors.
        #[expect(
            clippy::iter_over_hash_type,
            reason = "modeling command uses a HashMap and keys are random, so we don't really have a choice"
        )]
        for (cmd_id, resp) in responses.iter() {
            match resp {
                BatchResponse::Success { response } => {
                    if cmd_id == &id {
                        // This is the response we care about.
                        return Ok(OkWebSocketResponseData::Modeling {
                            modeling_response: response.clone(),
                        });
                    } else {
                        // Continue the loop if this is not the response we care about.
                        continue;
                    }
                }
                BatchResponse::Failure { errors } => {
                    // Get the source range for the command.
                    let source_range = id_to_source_range.get(cmd_id).cloned().ok_or_else(|| {
                        KclError::new_engine(KclErrorDetails::new(
                            format!("Failed to get source range for command ID: {cmd_id:?}"),
                            vec![],
                        ))
                    })?;
                    if errors.is_empty() {
                        return Err(KclError::new_engine(KclErrorDetails::new(
                            "Failure response for batch with no error details".to_owned(),
                            vec![source_range],
                        )));
                    }
                    return Err(KclError::new_engine(KclErrorDetails::new(
                        errors.iter().map(|e| e.message.clone()).collect::<Vec<_>>().join("\n"),
                        vec![source_range],
                    )));
                }
            }
        }

        // Return an error that we did not get an error or the response we wanted.
        // This should never happen but who knows.
        Err(KclError::new_engine(KclErrorDetails::new(
            format!("Failed to find response for command ID: {id:?}"),
            vec![],
        )))
    }

    async fn set_user_colors(
        &self,
        batch_context: &EngineBatchContext,
        settings: &ExecutorSettings,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
    ) -> Result<(), KclError> {
        let bf = settings
            .default_backface_color
            .clone()
            .unwrap_or(default_backface_color());
        let backface = csscolorparser::parse(&bf)
            .map(|color| kcmc::shared::Color::from_rgba(color.r, color.g, color.b, color.a))
            .unwrap_or(default_backface_color_struct());
        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::from(
                mcmd::SetDefaultSystemProperties::builder()
                    .backface_color(backface)
                    .build(),
            ),
        )
        .await?;
        Ok(())
    }

    async fn modify_grid(
        &self,
        batch_context: &EngineBatchContext,
        hidden: bool,
        grid_scale_behavior: GridScaleBehavior,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
    ) -> Result<(), KclError> {
        // Hide/show the grid.
        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::from(
                mcmd::ObjectVisible::builder()
                    .hidden(hidden)
                    .object_id(*GRID_OBJECT_ID)
                    .build(),
            ),
        )
        .await?;

        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &grid_scale_behavior.into_modeling_cmd(),
        )
        .await?;

        // Hide/show the grid scale text.
        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::from(
                mcmd::ObjectVisible::builder()
                    .hidden(hidden)
                    .object_id(*GRID_SCALE_TEXT_OBJECT_ID)
                    .build(),
            ),
        )
        .await?;

        Ok(())
    }

    pub async fn clear_queues(&self, batch_context: &EngineBatchContext) {
        batch_context.clear().await;
        self.ids_of_async_commands().write().await.clear();
        self.async_tasks().clear().await;
    }

    fn responses(&self) -> Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>> {
        self.responses.responses.clone()
    }

    fn ids_of_async_commands(&self) -> Arc<RwLock<IndexMap<Uuid, SourceRange>>> {
        self.ids_of_async_commands.clone()
    }

    fn async_tasks(&self) -> AsyncTasks {
        self.async_tasks.clone()
    }

    pub fn stats(&self) -> &EngineStats {
        &self.stats
    }

    pub fn get_default_planes(&self) -> Arc<RwLock<Option<DefaultPlanes>>> {
        self.default_planes.clone()
    }

    async fn clear_scene_post_hook(
        &self,
        batch_context: &EngineBatchContext,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<(), KclError> {
        // Remake the default planes, since they would have been removed after the scene was cleared.
        let new_planes = self
            .new_default_planes(batch_context, id_generator, source_range)
            .await?;
        *self.default_planes.write().await = Some(new_planes);

        self.transport.start_new_session(source_range).await?;

        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        let response = self
            .transport
            .inner_send_modeling_cmd(id, source_range, cmd, id_to_source_range)
            .await?;

        self.responses.add(id, response.clone()).await;
        Ok(response)
    }

    pub async fn get_session_data(&self) -> Option<ModelingSessionData> {
        self.session_data.read().await.clone()
    }

    pub async fn close(&self) {
        let _ = self.transport.close().await;
    }
}

/// State of the connection to the engine.
#[derive(Debug, PartialEq)]
pub enum SocketHealth {
    Active,
    Inactive,
}
