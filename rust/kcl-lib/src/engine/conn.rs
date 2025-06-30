//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use std::{collections::HashMap, sync::Arc};

use anyhow::{Result, anyhow};
use futures::{SinkExt, StreamExt};
use indexmap::IndexMap;
use kcmc::{
    ModelingCmd,
    websocket::{
        BatchResponse, FailureWebSocketResponse, ModelingCmdReq, ModelingSessionData, OkWebSocketResponseData,
        SuccessWebSocketResponse, WebSocketRequest, WebSocketResponse,
    },
};
use kittycad_modeling_cmds::{self as kcmc};
use tokio::sync::{RwLock, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message as WsMsg;
use uuid::Uuid;

use crate::{
    SourceRange,
    engine::{AsyncTasks, EngineManager, EngineStats},
    errors::{KclError, KclErrorDetails},
    execution::{DefaultPlanes, IdGenerator},
};

#[derive(Debug, PartialEq)]
enum SocketHealth {
    Active,
    Inactive,
}

type WebSocketTcpWrite = futures::stream::SplitSink<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>, WsMsg>;
#[derive(Debug)]
pub struct EngineConnection {
    engine_req_tx: mpsc::Sender<ToEngineReq>,
    shutdown_tx: mpsc::Sender<()>,
    responses: ResponseInformation,
    pending_errors: Arc<RwLock<Vec<String>>>,
    #[allow(dead_code)]
    tcp_read_handle: Arc<TcpReadHandle>,
    socket_health: Arc<RwLock<SocketHealth>>,
    batch: Arc<RwLock<Vec<(WebSocketRequest, SourceRange)>>>,
    batch_end: Arc<RwLock<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>>,
    ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>>,

    /// The default planes for the scene.
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    /// If the server sends session data, it'll be copied to here.
    session_data: Arc<RwLock<Option<ModelingSessionData>>>,

    stats: EngineStats,

    async_tasks: AsyncTasks,

    debug_info: Arc<RwLock<Option<OkWebSocketResponseData>>>,
}

pub struct TcpRead {
    stream: futures::stream::SplitStream<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>>,
}

/// Occurs when client couldn't read from the WebSocket to the engine.
// #[derive(Debug)]
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

impl TcpRead {
    pub async fn read(&mut self) -> std::result::Result<WebSocketResponse, WebSocketReadError> {
        let Some(msg) = self.stream.next().await else {
            return Err(anyhow::anyhow!("Failed to read from WebSocket").into());
        };
        let msg = match msg {
            Ok(msg) => msg,
            Err(e) if matches!(e, tokio_tungstenite::tungstenite::Error::Protocol(_)) => {
                return Err(WebSocketReadError::Read(e));
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

/// Information about the responses from the engine.
#[derive(Clone, Debug)]
struct ResponseInformation {
    /// The responses from the engine.
    responses: Arc<RwLock<IndexMap<uuid::Uuid, WebSocketResponse>>>,
}

impl ResponseInformation {
    pub async fn add(&self, id: Uuid, response: WebSocketResponse) {
        self.responses.write().await.insert(id, response);
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
    async fn start_write_actor(
        mut tcp_write: WebSocketTcpWrite,
        mut engine_req_rx: mpsc::Receiver<ToEngineReq>,
        mut shutdown_rx: mpsc::Receiver<()>,
    ) {
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
            }
        }

        // If we exit the loop (e.g. engine_req_rx was closed),
        // still gracefully close the engine before returning.
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
            .send(WsMsg::Text(msg.into()))
            .await
            .map_err(|e| anyhow!("could not send json over websocket: {e}"))?;
        Ok(())
    }

    /// Send the given `request` to the engine via the WebSocket connection `tcp_write` as binary.
    async fn inner_send_to_engine_binary(request: WebSocketRequest, tcp_write: &mut WebSocketTcpWrite) -> Result<()> {
        let msg = bson::to_vec(&request).map_err(|e| anyhow!("could not serialize bson: {e}"))?;
        tcp_write
            .send(WsMsg::Binary(msg.into()))
            .await
            .map_err(|e| anyhow!("could not send json over websocket: {e}"))?;
        Ok(())
    }

    pub async fn new(ws: reqwest::Upgraded) -> Result<EngineConnection> {
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
        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);
        tokio::task::spawn(Self::start_write_actor(tcp_write, engine_req_rx, shutdown_rx));

        let mut tcp_read = TcpRead { stream: tcp_read };

        let session_data: Arc<RwLock<Option<ModelingSessionData>>> = Arc::new(RwLock::new(None));
        let session_data2 = session_data.clone();
        let ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>> = Arc::new(RwLock::new(IndexMap::new()));
        let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
        let pending_errors = Arc::new(RwLock::new(Vec::new()));
        let pending_errors_clone = pending_errors.clone();
        let response_information = ResponseInformation {
            responses: Arc::new(RwLock::new(IndexMap::new())),
        };
        let response_information_cloned = response_information.clone();
        let debug_info = Arc::new(RwLock::new(None));
        let debug_info_cloned = debug_info.clone();

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
                                            response_information_cloned
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
                                            response_information_cloned
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
                                let mut sd = session_data2.write().await;
                                sd.replace(session.clone());
                            }
                            WebSocketResponse::Failure(FailureWebSocketResponse {
                                success: _,
                                request_id,
                                errors,
                            }) => {
                                if let Some(id) = request_id {
                                    response_information_cloned
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
                                    let mut pe = pending_errors_clone.write().await;
                                    for error in errors {
                                        if !pe.contains(&error.message) {
                                            pe.push(error.message.clone());
                                        }
                                    }
                                    drop(pe);
                                }
                            }
                            WebSocketResponse::Success(SuccessWebSocketResponse {
                                resp: debug @ OkWebSocketResponseData::Debug { .. },
                                ..
                            }) => {
                                let mut handle = debug_info_cloned.write().await;
                                *handle = Some(debug.clone());
                            }
                            _ => {}
                        }

                        if let Some(id) = id {
                            response_information_cloned.add(id, ws_resp.clone()).await;
                        }
                    }
                    Err(e) => {
                        match &e {
                            WebSocketReadError::Read(e) => crate::logln!("could not read from WS: {:?}", e),
                            WebSocketReadError::Deser(e) => crate::logln!("could not deserialize msg from WS: {:?}", e),
                        }
                        *socket_health_tcp_read.write().await = SocketHealth::Inactive;
                        return Err(e);
                    }
                }
            }
        });

        Ok(EngineConnection {
            engine_req_tx,
            shutdown_tx,
            tcp_read_handle: Arc::new(TcpReadHandle {
                handle: Arc::new(tcp_read_handle),
            }),
            responses: response_information,
            pending_errors,
            socket_health,
            batch: Arc::new(RwLock::new(Vec::new())),
            batch_end: Arc::new(RwLock::new(IndexMap::new())),
            ids_of_async_commands,
            default_planes: Default::default(),
            session_data,
            stats: Default::default(),
            async_tasks: AsyncTasks::new(),
            debug_info,
        })
    }
}

#[async_trait::async_trait]
impl EngineManager for EngineConnection {
    fn batch(&self) -> Arc<RwLock<Vec<(WebSocketRequest, SourceRange)>>> {
        self.batch.clone()
    }

    fn batch_end(&self) -> Arc<RwLock<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>> {
        self.batch_end.clone()
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

    fn stats(&self) -> &EngineStats {
        &self.stats
    }

    fn get_default_planes(&self) -> Arc<RwLock<Option<DefaultPlanes>>> {
        self.default_planes.clone()
    }

    async fn get_debug(&self) -> Option<OkWebSocketResponseData> {
        self.debug_info.read().await.clone()
    }

    async fn fetch_debug(&self) -> Result<(), KclError> {
        let (tx, rx) = oneshot::channel();

        self.engine_req_tx
            .send(ToEngineReq {
                req: WebSocketRequest::Debug {},
                request_sent: tx,
            })
            .await
            .map_err(|e| KclError::new_engine(KclErrorDetails::new(format!("Failed to send debug: {e}"), vec![])))?;

        let _ = rx.await;
        Ok(())
    }

    async fn clear_scene_post_hook(
        &self,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<(), KclError> {
        // Remake the default planes, since they would have been removed after the scene was cleared.
        let new_planes = self.new_default_planes(id_generator, source_range).await?;
        *self.default_planes.write().await = Some(new_planes);

        Ok(())
    }

    async fn inner_fire_modeling_cmd(
        &self,
        _id: uuid::Uuid,
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
                KclError::new_engine(KclErrorDetails::new(
                    format!("could not send request to the engine actor: {e}"),
                    vec![source_range],
                ))
            })?
            .map_err(|e| {
                KclError::new_engine(KclErrorDetails::new(
                    format!("could not send request to the engine: {e}"),
                    vec![source_range],
                ))
            })?;

        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        self.inner_fire_modeling_cmd(id, source_range, cmd, id_to_source_range)
            .await?;

        // Wait for the response.
        let response_timeout = 300;
        let current_time = std::time::Instant::now();
        while current_time.elapsed().as_secs() < response_timeout {
            let guard = self.socket_health.read().await;
            if *guard == SocketHealth::Inactive {
                // Check if we have any pending errors.
                let pe = self.pending_errors.read().await;
                if !pe.is_empty() {
                    return Err(KclError::new_engine(KclErrorDetails::new(
                        pe.join(", ").to_string(),
                        vec![source_range],
                    )));
                } else {
                    return Err(KclError::new_engine(KclErrorDetails::new(
                        "Modeling command failed: websocket closed early".to_string(),
                        vec![source_range],
                    )));
                }
            }

            #[cfg(feature = "artifact-graph")]
            {
                // We cannot pop here or it will break the artifact graph.
                if let Some(resp) = self.responses.responses.read().await.get(&id) {
                    return Ok(resp.clone());
                }
            }
            #[cfg(not(feature = "artifact-graph"))]
            {
                if let Some(resp) = self.responses.responses.write().await.shift_remove(&id) {
                    return Ok(resp);
                }
            }
        }

        Err(KclError::new_engine(KclErrorDetails::new(
            format!("Modeling command timed out `{id}`"),
            vec![source_range],
        )))
    }

    async fn get_session_data(&self) -> Option<ModelingSessionData> {
        self.session_data.read().await.clone()
    }

    async fn close(&self) {
        let _ = self.shutdown_tx.send(()).await;
        loop {
            let guard = self.socket_health.read().await;
            if *guard == SocketHealth::Inactive {
                return;
            }
        }
    }
}
