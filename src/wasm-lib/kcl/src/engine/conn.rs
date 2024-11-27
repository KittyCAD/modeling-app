//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use indexmap::IndexMap;
use kcmc::{
    websocket::{
        BatchResponse, FailureWebSocketResponse, ModelingCmdReq, ModelingSessionData, OkWebSocketResponseData,
        SuccessWebSocketResponse, WebSocketRequest, WebSocketResponse,
    },
    ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio_tungstenite::tungstenite::Message as WsMsg;

use crate::{
    engine::EngineManager,
    errors::{KclError, KclErrorDetails},
    executor::{DefaultPlanes, IdGenerator},
};

use super::ExecutionKind;

#[derive(Debug, PartialEq)]
enum SocketHealth {
    Active,
    Inactive,
}

type WebSocketTcpWrite = futures::stream::SplitSink<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>, WsMsg>;
#[derive(Debug, Clone)]
pub struct EngineConnection {
    engine_req_tx: mpsc::Sender<ToEngineReq>,
    responses: Arc<DashMap<uuid::Uuid, WebSocketResponse>>,
    pending_errors: Arc<Mutex<Vec<String>>>,
    #[allow(dead_code)]
    tcp_read_handle: Arc<TcpReadHandle>,
    socket_health: Arc<Mutex<SocketHealth>>,
    batch: Arc<Mutex<Vec<(WebSocketRequest, crate::executor::SourceRange)>>>,
    batch_end: Arc<Mutex<IndexMap<uuid::Uuid, (WebSocketRequest, crate::executor::SourceRange)>>>,

    /// The default planes for the scene.
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    /// If the server sends session data, it'll be copied to here.
    session_data: Arc<Mutex<Option<ModelingSessionData>>>,

    execution_kind: Arc<Mutex<ExecutionKind>>,
}

pub struct TcpRead {
    stream: futures::stream::SplitStream<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>>,
}

/// Occurs when client couldn't read from the WebSocket to the engine.
// #[derive(Debug)]
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

impl TcpRead {
    pub async fn read(&mut self) -> std::result::Result<WebSocketResponse, WebSocketReadError> {
        let Some(msg) = self.stream.next().await else {
            return Err(anyhow::anyhow!("Failed to read from WebSocket").into());
        };
        let msg = match msg {
            Ok(msg) => msg,
            Err(e) if matches!(e, tokio_tungstenite::tungstenite::Error::Protocol(_)) => {
                return Err(WebSocketReadError::Read(e))
            }
            Err(e) => return Err(anyhow::anyhow!("Error reading from engine's WebSocket: {e}").into()),
        };
        let msg: WebSocketResponse = match msg {
            WsMsg::Text(text) => serde_json::from_str(&text)
                .map_err(anyhow::Error::from)
                .map_err(WebSocketReadError::from)?,
            WsMsg::Binary(bin) => bson::from_slice(&bin)
                .map_err(anyhow::Error::from)
                .map_err(WebSocketReadError::from)?,
            other => return Err(anyhow::anyhow!("Unexpected WebSocket message from engine API: {other}").into()),
        };
        Ok(msg)
    }
}

pub struct TcpReadHandle {
    handle: Arc<tokio::task::JoinHandle<Result<(), WebSocketReadError>>>,
}

impl std::fmt::Debug for TcpReadHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TcpReadHandle")
    }
}

impl Drop for TcpReadHandle {
    fn drop(&mut self) {
        // Drop the read handle.
        self.handle.abort();
    }
}

/// Requests to send to the engine, and a way to await a response.
struct ToEngineReq {
    /// The request to send
    req: WebSocketRequest,
    /// If this resolves to Ok, the request was sent.
    /// If this resolves to Err, the request could not be sent.
    /// If this has not yet resolved, the request has not been sent yet.
    request_sent: oneshot::Sender<Result<()>>,
}

impl EngineConnection {
    /// Start waiting for incoming engine requests, and send each one over the WebSocket to the engine.
    async fn start_write_actor(mut tcp_write: WebSocketTcpWrite, mut engine_req_rx: mpsc::Receiver<ToEngineReq>) {
        while let Some(req) = engine_req_rx.recv().await {
            let ToEngineReq { req, request_sent } = req;
            let res = if let WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                cmd: ModelingCmd::ImportFiles { .. },
                cmd_id: _,
            }) = &req
            {
                // Send it as binary.
                Self::inner_send_to_engine_binary(req, &mut tcp_write).await
            } else {
                Self::inner_send_to_engine(req, &mut tcp_write).await
            };
            let _ = request_sent.send(res);
        }
        let _ = Self::inner_close_engine(&mut tcp_write).await;
    }

    /// Send the given `request` to the engine via the WebSocket connection `tcp_write`.
    async fn inner_close_engine(tcp_write: &mut WebSocketTcpWrite) -> Result<()> {
        tcp_write
            .send(WsMsg::Close(None))
            .await
            .map_err(|e| anyhow!("could not send close over websocket: {e}"))?;
        Ok(())
    }

    /// Send the given `request` to the engine via the WebSocket connection `tcp_write`.
    async fn inner_send_to_engine(request: WebSocketRequest, tcp_write: &mut WebSocketTcpWrite) -> Result<()> {
        let msg = serde_json::to_string(&request).map_err(|e| anyhow!("could not serialize json: {e}"))?;
        tcp_write
            .send(WsMsg::Text(msg))
            .await
            .map_err(|e| anyhow!("could not send json over websocket: {e}"))?;
        Ok(())
    }

    /// Send the given `request` to the engine via the WebSocket connection `tcp_write` as binary.
    async fn inner_send_to_engine_binary(request: WebSocketRequest, tcp_write: &mut WebSocketTcpWrite) -> Result<()> {
        let msg = bson::to_vec(&request).map_err(|e| anyhow!("could not serialize bson: {e}"))?;
        tcp_write
            .send(WsMsg::Binary(msg))
            .await
            .map_err(|e| anyhow!("could not send json over websocket: {e}"))?;
        Ok(())
    }

    pub async fn new(ws: reqwest::Upgraded) -> Result<EngineConnection> {
        let wsconfig = tokio_tungstenite::tungstenite::protocol::WebSocketConfig {
            // 4294967296 bytes, which is around 4.2 GB.
            max_message_size: Some(0x100000000),
            max_frame_size: Some(0x100000000),
            ..Default::default()
        };

        let ws_stream = tokio_tungstenite::WebSocketStream::from_raw_socket(
            ws,
            tokio_tungstenite::tungstenite::protocol::Role::Client,
            Some(wsconfig),
        )
        .await;

        let (tcp_write, tcp_read) = ws_stream.split();
        let (engine_req_tx, engine_req_rx) = mpsc::channel(10);
        tokio::task::spawn(Self::start_write_actor(tcp_write, engine_req_rx));

        let mut tcp_read = TcpRead { stream: tcp_read };

        let session_data: Arc<Mutex<Option<ModelingSessionData>>> = Arc::new(Mutex::new(None));
        let session_data2 = session_data.clone();
        let responses: Arc<DashMap<uuid::Uuid, WebSocketResponse>> = Arc::new(DashMap::new());
        let responses_clone = responses.clone();
        let socket_health = Arc::new(Mutex::new(SocketHealth::Active));
        let pending_errors = Arc::new(Mutex::new(Vec::new()));
        let pending_errors_clone = pending_errors.clone();

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
                                for (resp_id, batch_response) in responses {
                                    let id: uuid::Uuid = (*resp_id).into();
                                    match batch_response {
                                        BatchResponse::Success { response } => {
                                            responses_clone.insert(
                                                id,
                                                WebSocketResponse::Success(SuccessWebSocketResponse {
                                                    success: true,
                                                    request_id: Some(id),
                                                    resp: OkWebSocketResponseData::Modeling {
                                                        modeling_response: response.clone(),
                                                    },
                                                }),
                                            );
                                        }
                                        BatchResponse::Failure { errors } => {
                                            responses_clone.insert(
                                                id,
                                                WebSocketResponse::Failure(FailureWebSocketResponse {
                                                    success: false,
                                                    request_id: Some(id),
                                                    errors: errors.clone(),
                                                }),
                                            );
                                        }
                                    }
                                }
                            }
                            WebSocketResponse::Success(SuccessWebSocketResponse {
                                resp: OkWebSocketResponseData::ModelingSessionData { session },
                                ..
                            }) => {
                                let mut sd = session_data2.lock().unwrap();
                                sd.replace(session.clone());
                            }
                            WebSocketResponse::Failure(FailureWebSocketResponse {
                                success: _,
                                request_id,
                                errors,
                            }) => {
                                if let Some(id) = request_id {
                                    responses_clone.insert(
                                        *id,
                                        WebSocketResponse::Failure(FailureWebSocketResponse {
                                            success: false,
                                            request_id: *request_id,
                                            errors: errors.clone(),
                                        }),
                                    );
                                } else {
                                    // Add it to our pending errors.
                                    let mut pe = pending_errors_clone.lock().unwrap();
                                    for error in errors {
                                        if !pe.contains(&error.message) {
                                            pe.push(error.message.clone());
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }

                        if let Some(id) = id {
                            responses_clone.insert(id, ws_resp.clone());
                        }
                    }
                    Err(e) => {
                        match &e {
                            WebSocketReadError::Read(e) => crate::logln!("could not read from WS: {:?}", e),
                            WebSocketReadError::Deser(e) => crate::logln!("could not deserialize msg from WS: {:?}", e),
                        }
                        *socket_health_tcp_read.lock().unwrap() = SocketHealth::Inactive;
                        return Err(e);
                    }
                }
            }
        });

        Ok(EngineConnection {
            engine_req_tx,
            tcp_read_handle: Arc::new(TcpReadHandle {
                handle: Arc::new(tcp_read_handle),
            }),
            responses,
            pending_errors,
            socket_health,
            batch: Arc::new(Mutex::new(Vec::new())),
            batch_end: Arc::new(Mutex::new(IndexMap::new())),
            default_planes: Default::default(),
            session_data,
            execution_kind: Default::default(),
        })
    }
}

#[async_trait::async_trait]
impl EngineManager for EngineConnection {
    fn batch(&self) -> Arc<Mutex<Vec<(WebSocketRequest, crate::executor::SourceRange)>>> {
        self.batch.clone()
    }

    fn batch_end(&self) -> Arc<Mutex<IndexMap<uuid::Uuid, (WebSocketRequest, crate::executor::SourceRange)>>> {
        self.batch_end.clone()
    }

    fn execution_kind(&self) -> ExecutionKind {
        let guard = self.execution_kind.lock().unwrap();
        *guard
    }

    fn replace_execution_kind(&self, execution_kind: ExecutionKind) -> ExecutionKind {
        let mut guard = self.execution_kind.lock().unwrap();
        let original = *guard;
        *guard = execution_kind;
        original
    }

    async fn default_planes(
        &self,
        id_generator: &mut IdGenerator,
        source_range: crate::executor::SourceRange,
    ) -> Result<DefaultPlanes, KclError> {
        {
            let opt = self.default_planes.read().await.as_ref().cloned();
            if let Some(planes) = opt {
                return Ok(planes);
            }
        } // drop the read lock

        let new_planes = self.new_default_planes(id_generator, source_range).await?;
        *self.default_planes.write().await = Some(new_planes.clone());

        Ok(new_planes)
    }

    async fn clear_scene_post_hook(
        &self,
        id_generator: &mut IdGenerator,
        source_range: crate::executor::SourceRange,
    ) -> Result<(), KclError> {
        // Remake the default planes, since they would have been removed after the scene was cleared.
        let new_planes = self.new_default_planes(id_generator, source_range).await?;
        *self.default_planes.write().await = Some(new_planes);

        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: WebSocketRequest,
        _id_to_source_range: std::collections::HashMap<uuid::Uuid, crate::executor::SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        let (tx, rx) = oneshot::channel();

        // Send the request to the engine, via the actor.
        self.engine_req_tx
            .send(ToEngineReq {
                req: cmd.clone(),
                request_sent: tx,
            })
            .await
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: format!("Failed to send modeling command: {}", e),
                    source_ranges: vec![source_range],
                })
            })?;

        // Wait for the request to be sent.
        rx.await
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: format!("could not send request to the engine actor: {e}"),
                    source_ranges: vec![source_range],
                })
            })?
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: format!("could not send request to the engine: {e}"),
                    source_ranges: vec![source_range],
                })
            })?;

        // Wait for the response.
        let current_time = std::time::Instant::now();
        while current_time.elapsed().as_secs() < 60 {
            if let Ok(guard) = self.socket_health.lock() {
                if *guard == SocketHealth::Inactive {
                    // Check if we have any pending errors.
                    let pe = self.pending_errors.lock().unwrap();
                    if !pe.is_empty() {
                        return Err(KclError::Engine(KclErrorDetails {
                            message: pe.join(", ").to_string(),
                            source_ranges: vec![source_range],
                        }));
                    } else {
                        return Err(KclError::Engine(KclErrorDetails {
                            message: "Modeling command failed: websocket closed early".to_string(),
                            source_ranges: vec![source_range],
                        }));
                    }
                }
            }
            // We pop off the responses to cleanup our mappings.
            if let Some((_, resp)) = self.responses.remove(&id) {
                return Ok(resp);
            }
        }

        Err(KclError::Engine(KclErrorDetails {
            message: format!("Modeling command timed out `{}`", id),
            source_ranges: vec![source_range],
        }))
    }

    fn get_session_data(&self) -> Option<ModelingSessionData> {
        self.session_data.lock().unwrap().clone()
    }
}
