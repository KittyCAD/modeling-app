//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use kittycad::types::{OkWebSocketResponseData, WebSocketRequest, WebSocketResponse};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message as WsMsg;

use crate::{
    engine::EngineManager,
    errors::{KclError, KclErrorDetails},
};

type WebSocketTcpWrite = futures::stream::SplitSink<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>, WsMsg>;
#[derive(Debug, Clone)]
pub struct EngineConnection {
    engine_req_tx: mpsc::Sender<ToEngineReq>,
    tcp_read_handle: Arc<tokio::task::JoinHandle<Result<()>>>,
    responses: Arc<DashMap<uuid::Uuid, WebSocketResponse>>,
}

impl Drop for EngineConnection {
    fn drop(&mut self) {
        // Drop the read handle.
        self.tcp_read_handle.abort();
    }
}

pub struct TcpRead {
    stream: futures::stream::SplitStream<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>>,
}

impl TcpRead {
    pub async fn read(&mut self) -> Result<WebSocketResponse> {
        let Some(msg) = self.stream.next().await else {
            anyhow::bail!("Failed to read from websocket");
        };
        let msg: WebSocketResponse = match msg? {
            WsMsg::Text(text) => serde_json::from_str(&text)?,
            WsMsg::Binary(bin) => bson::from_slice(&bin)?,
            other => anyhow::bail!("Unexpected websocket message from server: {}", other),
        };
        Ok(msg)
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
            let res = Self::inner_send_to_engine(req, &mut tcp_write).await;
            let _ = request_sent.send(res);
        }
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

    pub async fn new(ws: reqwest::Upgraded) -> Result<EngineConnection> {
        let ws_stream = tokio_tungstenite::WebSocketStream::from_raw_socket(
            ws,
            tokio_tungstenite::tungstenite::protocol::Role::Client,
            None,
        )
        .await;

        let (tcp_write, tcp_read) = ws_stream.split();
        let (engine_req_tx, engine_req_rx) = mpsc::channel(10);
        tokio::task::spawn(Self::start_write_actor(tcp_write, engine_req_rx));

        let mut tcp_read = TcpRead { stream: tcp_read };

        let responses: Arc<DashMap<uuid::Uuid, WebSocketResponse>> = Arc::new(DashMap::new());
        let responses_clone = responses.clone();

        let tcp_read_handle = tokio::spawn(async move {
            // Get Websocket messages from API server
            loop {
                match tcp_read.read().await {
                    Ok(ws_resp) => {
                        if let Some(id) = ws_resp.request_id {
                            responses_clone.insert(id, ws_resp.clone());
                        }
                    }
                    Err(e) => {
                        println!("got ws error: {:?}", e);
                        return Err(e);
                    }
                }
            }
        });

        Ok(EngineConnection {
            engine_req_tx,
            tcp_read_handle: Arc::new(tcp_read_handle),
            responses,
        })
    }
}

#[async_trait::async_trait(?Send)]
impl EngineManager for EngineConnection {
    async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        let (tx, rx) = oneshot::channel();

        // Send the request to the engine, via the actor.
        self.engine_req_tx
            .send(ToEngineReq {
                req: WebSocketRequest::ModelingCmdReq {
                    cmd: cmd.clone(),
                    cmd_id: id,
                },
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
            // We pop off the responses to cleanup our mappings.
            if let Some((_, resp)) = self.responses.remove(&id) {
                return if let Some(data) = &resp.resp {
                    Ok(data.clone())
                } else {
                    Err(KclError::Engine(KclErrorDetails {
                        message: format!("Modeling command failed: {:?}", resp.errors),
                        source_ranges: vec![source_range],
                    }))
                };
            }
        }

        Err(KclError::Engine(KclErrorDetails {
            message: format!("Modeling command timed out: {:?}", cmd),
            source_ranges: vec![source_range],
        }))
    }
}
