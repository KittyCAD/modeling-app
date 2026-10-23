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
use kittycad_modeling_cmds as kcmc;
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
        Self::read_message(self.stream.next().await)
    }

    fn read_message(
        msg: Option<Result<WsMsg, tokio_tungstenite::tungstenite::Error>>,
    ) -> Result<WebSocketResponse, WebSocketReadError> {
        let Some(msg) = msg else {
            return Err(WebSocketReadError::Closed("Failed to read from WebSocket".to_owned()));
        };
        let msg = msg.map_err(WebSocketReadError::Read)?;
        match msg {
            WsMsg::Text(text) => kcl_engine_codec::deserialize_response_json(&text)
                .map_err(anyhow::Error::from)
                .map_err(WebSocketReadError::from),
            WsMsg::Binary(bin) => kcl_engine_codec::deserialize_response_msgpack(&bin)
                .map_err(anyhow::Error::from)
                .map_err(WebSocketReadError::from),
            WsMsg::Close(close_frame) => {
                let err_msg = close_frame
                    .map(|frame| frame.reason.to_string())
                    .unwrap_or("WebSocket closed without specifying a reason.".to_string());
                Err(WebSocketReadError::Closed(err_msg))
            }
            other => Err(anyhow!("Unexpected WebSocket message from engine API: {other}").into()),
        }
    }
}

type WebSocketTcpWrite = futures::stream::SplitSink<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>, WsMsg>;
const CLOSE_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(1);

/// Sends requests to the engine over its Modeling API WebSocket.
/// Used on native platforms, does not work in browser WASM sandbox.
pub struct WebSocketTransport {
    tcp_read_handle: tokio::task::AbortHandle,
    tcp_write_handle: tokio::task::AbortHandle,
    engine_req_tx: mpsc::Sender<ToEngineReq>,
    shutdown_tx: mpsc::Sender<()>,
    responses: ResponseInformation,
    pending_errors: Arc<RwLock<Vec<KclError>>>,
    session_data: Arc<RwLock<Option<ModelingSessionData>>>,
    socket_health: Arc<RwLock<SocketHealth>>,
    upgrade_request_id: Option<String>,
}

impl Drop for WebSocketTransport {
    fn drop(&mut self) {
        self.tcp_read_handle.abort();
        self.tcp_write_handle.abort();
    }
}

/// Occurs when client couldn't read from the WebSocket to the engine.
#[allow(clippy::large_enum_variant)]
pub enum WebSocketReadError {
    /// Could not read a message due to WebSocket errors.
    Read(tokio_tungstenite::tungstenite::Error),
    /// The peer closed the WebSocket or the stream ended.
    Closed(String),
    /// WebSocket message didn't contain a valid message that the KCL Executor could parse.
    Deser(anyhow::Error),
}

impl WebSocketReadError {
    fn into_kcl_error(self) -> KclError {
        match self {
            Self::Read(error) => KclError::new_engine_hangup(
                KclErrorDetails::new(format!("Error reading from engine's WebSocket: {error}"), vec![]),
                None,
            ),
            Self::Closed(message) => KclError::new_engine_hangup(KclErrorDetails::new(message, vec![]), None),
            Self::Deser(error) => KclError::new_engine(KclErrorDetails::new(error.to_string(), vec![])),
        }
    }
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
        pending_errors: Arc<RwLock<Vec<KclError>>>,
        socket_health: Arc<RwLock<SocketHealth>>,
        upgrade_request_id: Option<String>,
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
        let tcp_write_handle = tokio::task::spawn(Self::start_write_actor(
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
                                        if !pe.iter().any(|pending| pending.message() == error.message) {
                                            pe.push(KclError::new_engine(KclErrorDetails::new(
                                                error.message.clone(),
                                                vec![],
                                            )));
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
                        pending_errors_for_read.write().await.push(e.into_kcl_error());
                        *socket_health_tcp_read.write().await = SocketHealth::Inactive;
                        return;
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
            upgrade_request_id,
            engine_req_tx,
            tcp_read_handle: tcp_read_handle.abort_handle(),
            tcp_write_handle: tcp_write_handle.abort_handle(),
        }
    }

    fn connection_id_message(&self, session: Option<&ModelingSessionData>) -> String {
        if let Some(session) = session {
            format!(" (API call ID: {})", session.api_call_id)
        } else if let Some(id) = &self.upgrade_request_id {
            format!(" (Engine upgrade request ID: {id})")
        } else {
            " (No API call ID: session data empty)".to_string()
        }
    }

    async fn pending_error(&self, source_range: SourceRange) -> Option<KclError> {
        let session_data = self.session_data.read().await;
        let pending_errors = self.pending_errors.read().await;
        // A read failure can follow an uncorrelated engine error. Preserve the
        // hangup classification so that the interrupted execution can be retried.
        let mut error = pending_errors
            .iter()
            .find(|error| matches!(error, KclError::EngineHangup { .. }))
            .or_else(|| pending_errors.first())?
            .clone();
        *error.details_mut() = KclErrorDetails::new(
            format!(
                "{}{}",
                pending_errors
                    .iter()
                    .map(KclError::message)
                    .collect::<Vec<_>>()
                    .join(", "),
                self.connection_id_message(session_data.as_ref())
            ),
            vec![source_range],
        );
        if let KclError::EngineHangup { api_call_id, .. } = &mut error {
            *api_call_id = session_data.as_ref().map(|session| session.api_call_id.to_string());
        }
        Some(error)
    }

    async fn inner_send_to_engine_binary(
        request: WebSocketRequest,
        tcp_write: &mut WebSocketTcpWrite,
    ) -> anyhow::Result<()> {
        let msg = kcl_engine_codec::serialize_request_msgpack(&request)
            .map_err(|e| anyhow!("could not serialize msgpack: {e}"))?;
        tcp_write
            .send(WsMsg::Binary(msg.into()))
            .await
            .map_err(|e| anyhow!("could not send MsgPack over websocket: {e}"))?;
        Ok(())
    }

    /// Send the given `request` to the engine via the WebSocket connection `tcp_write`.
    async fn inner_send_to_engine(request: WebSocketRequest, tcp_write: &mut WebSocketTcpWrite) -> anyhow::Result<()> {
        let msg =
            kcl_engine_codec::serialize_request_json(&request).map_err(|e| anyhow!("could not serialize json: {e}"))?;
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
                            let binary = matches!(
                                &req,
                                WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                                    cmd: ModelingCmd::ImportFiles { .. },
                                    cmd_id: _,
                                })
                            );
                            let binary = binary || matches!(&req, WebSocketRequest::ExecKclProject { .. });
                            let res = if binary {
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

    async fn close_with_timeout(&self, timeout: Duration) {
        let _ = self.shutdown_tx.try_send(());
        let _ = tokio::time::timeout(timeout, async {
            loop {
                if *self.socket_health.read().await == SocketHealth::Inactive {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await;
        // An inactive reader does not guarantee the writer has finished sending.
        // It could have encountered an error.
        // So, the graceful timeout request above may not have worked.
        // So, we should abort here, in case it's still trying to send.
        // Aborting a task that has already completed is a no-op.
        // Aborting a task that's stuck or in-progress and didn't gracefully shutdown will
        // accomplish our goal (stopping). So either way, we should abort.
        self.tcp_read_handle.abort();
        self.tcp_write_handle.abort();
        *self.socket_health.write().await = SocketHealth::Inactive;
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

        let api_call_id_msg = self.connection_id_message(self.session_data.read().await.as_ref());

        // Send the request to the engine, via the actor.
        self.engine_req_tx
            .send(ToEngineReq {
                req: cmd.clone(),
                request_sent: tx,
            })
            .await
            .map_err(|e| {
                KclError::new_engine_hangup(
                    KclErrorDetails::new(
                        format!("Failed to send modeling command: {e}{api_call_id_msg}"),
                        vec![source_range],
                    ),
                    None,
                )
            })?;

        // Wait for the request to be sent.
        let send_result = rx.await.map_err(|e| {
            KclError::new_engine_hangup(
                KclErrorDetails::new(
                    format!("could not send request to the engine actor: {e}{api_call_id_msg}"),
                    vec![source_range],
                ),
                None,
            )
        })?;

        if let Err(send_error) = send_result {
            if let Some(error) = self.pending_error(source_range).await {
                return Err(error);
            }

            return Err(KclError::new_engine_hangup(
                KclErrorDetails::new(
                    format!("could not send request to the engine: {send_error}{api_call_id_msg}"),
                    vec![source_range],
                ),
                None,
            ));
        }

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
                if let Some(error) = self.pending_error(source_range).await {
                    return Err(error);
                }
                // Get the API call ID from session data if available
                let session_data = self.session_data.read().await;
                let api_call_id = session_data.as_ref().map(|session| session.api_call_id.to_string());
                let api_call_id_msg = self.connection_id_message(session_data.as_ref());

                return Err(KclError::new_engine_hangup(
                    KclErrorDetails::new(
                        format!("Modeling command failed: websocket closed early{}", api_call_id_msg),
                        vec![source_range],
                    ),
                    api_call_id,
                ));
            }

            // We cannot pop here or it will break the artifact graph.
            if let Some(resp) = self.responses.responses.read().await.get(&cmd_id) {
                return Ok(resp.clone());
            }
        }

        // Get the API call ID from session data if available for timeout error
        let api_call_id_msg = self.connection_id_message(self.session_data.read().await.as_ref());

        Err(KclError::new_engine(KclErrorDetails::new(
            format!("Modeling command timed out `{cmd_id}`{}", api_call_id_msg),
            vec![source_range],
        )))
    }

    async fn close(&self) -> Result<(), TransportCloseError> {
        self.close_with_timeout(CLOSE_HANDSHAKE_TIMEOUT).await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ModuleId;
    use crate::errors::IsRetryable;

    fn connection_reset() -> tokio_tungstenite::tungstenite::Error {
        tokio_tungstenite::tungstenite::Error::Io(std::io::Error::from(std::io::ErrorKind::ConnectionReset))
    }

    #[test]
    fn socket_read_failures_are_retryable() {
        use tokio_tungstenite::tungstenite::Error;
        use tokio_tungstenite::tungstenite::error::ProtocolError;
        use tokio_tungstenite::tungstenite::protocol::CloseFrame;
        use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

        for message in [
            Some(Err(connection_reset())),
            Some(Err(Error::Protocol(ProtocolError::ResetWithoutClosingHandshake))),
            Some(Err(Error::ConnectionClosed)),
            Some(Ok(WsMsg::Close(None))),
            Some(Ok(WsMsg::Close(Some(CloseFrame {
                code: CloseCode::Away,
                reason: "server shutting down".into(),
            })))),
            None,
        ] {
            let error = TcpRead::read_message(message).unwrap_err().into_kcl_error();
            assert!(matches!(error, KclError::EngineHangup { .. }), "{error:?}");
            assert!(error.is_retryable());
        }
    }

    #[test]
    fn invalid_socket_messages_are_not_retryable() {
        for message in [
            WsMsg::Text("invalid json".into()),
            WsMsg::Binary(vec![0xc1].into()),
            WsMsg::Ping(Default::default()),
        ] {
            let error = TcpRead::read_message(Some(Ok(message))).unwrap_err().into_kcl_error();
            assert!(matches!(error, KclError::Engine { .. }), "{error:?}");
            assert!(!error.is_retryable());
        }
    }

    fn transport_with_pending_errors(
        pending_errors: Vec<KclError>,
        send_result: anyhow::Result<()>,
    ) -> WebSocketTransport {
        let read = tokio::spawn(std::future::pending::<()>());
        let (engine_req_tx, mut engine_req_rx) = mpsc::channel::<ToEngineReq>(1);
        let write = tokio::spawn(async move {
            let request = engine_req_rx.recv().await.expect("a request should be sent");
            let _ = request.request_sent.send(send_result);
        });
        let (shutdown_tx, _shutdown_rx) = mpsc::channel(1);
        WebSocketTransport {
            tcp_read_handle: read.abort_handle(),
            tcp_write_handle: write.abort_handle(),
            engine_req_tx,
            shutdown_tx,
            responses: ResponseInformation::new(Arc::new(RwLock::new(Default::default()))),
            pending_errors: Arc::new(RwLock::new(pending_errors)),
            session_data: Arc::new(RwLock::new(Some(ModelingSessionData {
                api_call_id: "test-api-call-id".to_owned(),
            }))),
            socket_health: Arc::new(RwLock::new(SocketHealth::Inactive)),
            upgrade_request_id: None,
        }
    }

    #[tokio::test]
    async fn pending_read_failure_is_retryable_when_waiting_or_sending_fails() {
        let source_range = SourceRange::new(10, 20, ModuleId::default());
        for send_result in [Ok(()), Err(anyhow!("socket is closed"))] {
            let transport = transport_with_pending_errors(
                vec![
                    KclError::new_engine(KclErrorDetails::new("earlier engine error".to_owned(), vec![])),
                    TcpRead::read_message(Some(Err(connection_reset())))
                        .unwrap_err()
                        .into_kcl_error(),
                ],
                send_result,
            );
            let error = transport
                .inner_send_modeling_cmd(Uuid::new_v4(), source_range, WebSocketRequest::Ping {}, HashMap::new())
                .await
                .unwrap_err();
            assert!(error.is_retryable(), "{error:?}");
            assert_eq!(error.source_ranges(), vec![source_range]);
            assert!(error.message().contains("earlier engine error"));
            assert!(error.message().to_ascii_lowercase().contains("connection reset"));
            assert!(error.message().contains("test-api-call-id"));
            assert!(matches!(
                error,
                KclError::EngineHangup { api_call_id: Some(id), .. }
                    if id == "test-api-call-id"
            ));
        }
    }

    #[tokio::test]
    async fn pending_engine_and_deserialization_errors_are_not_retryable() {
        for pending_error in [
            KclError::new_engine(KclErrorDetails::new("invalid modeling command".to_owned(), vec![])),
            WebSocketReadError::Deser(anyhow!("invalid engine response")).into_kcl_error(),
        ] {
            for send_result in [Ok(()), Err(anyhow!("socket is closed"))] {
                let transport = transport_with_pending_errors(vec![pending_error.clone()], send_result);
                let error = transport
                    .inner_send_modeling_cmd(
                        Uuid::new_v4(),
                        SourceRange::default(),
                        WebSocketRequest::Ping {},
                        HashMap::new(),
                    )
                    .await
                    .unwrap_err();
                assert!(!error.is_retryable(), "{error:?}");
                assert!(error.message().contains(pending_error.message()));
            }
        }
    }

    #[tokio::test]
    async fn stopped_writer_is_retryable() {
        let transport = transport_with_pending_errors(vec![], Ok(()));
        transport.tcp_write_handle.abort();
        while !transport.engine_req_tx.is_closed() {
            tokio::task::yield_now().await;
        }
        let error = transport
            .inner_fire_modeling_cmd(
                Uuid::new_v4(),
                SourceRange::default(),
                WebSocketRequest::Ping {},
                HashMap::new(),
            )
            .await
            .unwrap_err();
        assert!(error.is_retryable(), "{error:?}");
        assert!(error.message().contains("Failed to send modeling command"));
    }

    #[tokio::test]
    async fn close_aborts_writer_when_reader_stops_before_timeout() {
        let write = tokio::spawn(std::future::pending::<()>());
        let (engine_req_tx, _engine_req_rx) = mpsc::channel(1);
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel(1);
        let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
        let read_health = socket_health.clone();
        let read = tokio::spawn(async move {
            // Simulate the reader observing the peer's close after shutdown is requested.
            shutdown_rx.recv().await.expect("shutdown should be requested");
            *read_health.write().await = SocketHealth::Inactive;
        });
        let transport = WebSocketTransport {
            tcp_read_handle: read.abort_handle(),
            tcp_write_handle: write.abort_handle(),
            engine_req_tx,
            shutdown_tx,
            responses: ResponseInformation::new(Arc::new(RwLock::new(Default::default()))),
            pending_errors: Arc::new(RwLock::new(Vec::new())),
            session_data: Arc::new(RwLock::new(None)),
            socket_health: socket_health.clone(),
            upgrade_request_id: None,
        };

        tokio::time::timeout(Duration::from_secs(1), async {
            // The outer deadline ensures we exercise completion before the close timeout.
            transport.close_with_timeout(Duration::from_secs(10)).await;
            read.await.expect("reader should finish normally");
            assert!(write.await.unwrap_err().is_cancelled());
        })
        .await
        .expect("close should abort the writer even when the reader has stopped");

        assert_eq!(*socket_health.read().await, SocketHealth::Inactive);
    }

    #[tokio::test]
    async fn close_aborts_tasks_when_peer_does_not_close() {
        let read = tokio::spawn(std::future::pending::<()>());
        let write = tokio::spawn(std::future::pending::<()>());
        let (engine_req_tx, _engine_req_rx) = mpsc::channel(1);
        let (shutdown_tx, _shutdown_rx) = mpsc::channel(1);
        let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
        let transport = WebSocketTransport {
            tcp_read_handle: read.abort_handle(),
            tcp_write_handle: write.abort_handle(),
            engine_req_tx,
            shutdown_tx,
            responses: ResponseInformation::new(Arc::new(RwLock::new(Default::default()))),
            pending_errors: Arc::new(RwLock::new(Vec::new())),
            session_data: Arc::new(RwLock::new(None)),
            socket_health: socket_health.clone(),
            upgrade_request_id: None,
        };

        tokio::time::timeout(
            Duration::from_secs(1),
            transport.close_with_timeout(Duration::from_millis(1)),
        )
        .await
        .expect("close should be bounded");

        assert_eq!(*socket_health.read().await, SocketHealth::Inactive);
        assert!(read.await.unwrap_err().is_cancelled());
        assert!(write.await.unwrap_err().is_cancelled());
    }
}
