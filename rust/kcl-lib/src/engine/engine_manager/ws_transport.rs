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
        // Passed via EngineManager from elsewhere
        ws: reqwest::Upgraded,
        heartbeats: Option<u64>,

        // Created by EngineManager
        response_information: ResponseInformation,
        session_data: Arc<RwLock<Option<ModelingSessionData>>>,
        pending_errors: Arc<RwLock<Vec<String>>>,
        socket_health: Arc<RwLock<SocketHealth>>,
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
        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);
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
                                // Deleted, I don't think this was ever used.
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
    async fn inner_send_to_engine(request: WebSocketRequest, tcp_write: &mut WebSocketTcpWrite) -> anyhow::Result<()> {
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
                            let res = if matches!(
                                &req,
                                WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                                    cmd: ModelingCmd::ImportFiles { .. },
                                    cmd_id: _,
                                }) | WebSocketRequest::ExecKclProject { .. }
                            ) {
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
                // Get the API call ID from session data if available
                let session_data = self.session_data.read().await;
                let api_call_id = session_data.as_ref().map(|session| session.api_call_id.to_string());
                let api_call_id_msg = if let Some(ref id) = api_call_id {
                    format!(" (API call ID: {})", id)
                } else {
                    String::new()
                };

                // Check if we have any pending errors.
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

            // We cannot pop here or it will break the artifact graph.
            if let Some(resp) = self.responses.responses.read().await.get(&cmd_id) {
                return Ok(resp.clone());
            }
        }

        // Get the API call ID from session data if available for timeout error
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
