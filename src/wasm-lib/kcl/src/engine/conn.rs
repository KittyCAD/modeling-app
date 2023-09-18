//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use std::sync::Arc;

use anyhow::Result;
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use kittycad::types::{OkWebSocketResponseData, WebSocketRequest, WebSocketResponse};
use tokio_tungstenite::tungstenite::Message as WsMsg;

use crate::{
    engine::EngineManager,
    errors::{KclError, KclErrorDetails},
};

#[derive(Debug)]
pub struct EngineConnection {
    tcp_write: futures::stream::SplitSink<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>, WsMsg>,
    tcp_read_handle: tokio::task::JoinHandle<Result<()>>,
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

impl EngineConnection {
    pub async fn new(ws: reqwest::Upgraded) -> Result<EngineConnection> {
        let ws_stream = tokio_tungstenite::WebSocketStream::from_raw_socket(
            ws,
            tokio_tungstenite::tungstenite::protocol::Role::Client,
            None,
        )
        .await;

        let (tcp_write, tcp_read) = ws_stream.split();

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
            tcp_write,
            tcp_read_handle,
            responses,
        })
    }

    pub async fn tcp_send(&mut self, msg: WebSocketRequest) -> Result<()> {
        let msg = serde_json::to_string(&msg)?;
        self.tcp_write.send(WsMsg::Text(msg)).await?;

        Ok(())
    }
}

#[async_trait::async_trait(?Send)]
impl EngineManager for EngineConnection {
    /// Send a modeling command.
    /// Do not wait for the response message.
    fn send_modeling_cmd(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
        futures::executor::block_on(self.tcp_send(WebSocketRequest::ModelingCmdReq { cmd, cmd_id: id })).map_err(
            |e| {
                KclError::Engine(KclErrorDetails {
                    message: format!("Failed to send modeling command: {}", e),
                    source_ranges: vec![source_range],
                })
            },
        )?;
        Ok(())
    }

    /// Send a modeling command and wait for the response message.
    fn send_modeling_cmd_get_response_blocking(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        let result = futures::executor::block_on(self.send_modeling_cmd_get_response(id, source_range, cmd))?;

        Ok(result)
    }

    /// Send a modeling command and wait for the response message.
    async fn send_modeling_cmd_get_response(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        self.tcp_send(WebSocketRequest::ModelingCmdReq { cmd, cmd_id: id })
            .await
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: format!("Failed to send modeling command: {}", e),
                    source_ranges: vec![source_range],
                })
            })?;

        // Wait for the response.
        let current_time = std::time::Instant::now();
        while current_time.elapsed().as_secs() < 10 {
            if let Some(resp) = self.responses.get(&id) {
                if let Some(data) = &resp.resp {
                    return Ok(data.clone());
                } else {
                    return Err(KclError::Engine(KclErrorDetails {
                        message: format!("Modeling command failed: {:?}", resp.errors),
                        source_ranges: vec![source_range],
                    }));
                }
            }
        }

        Err(KclError::Engine(KclErrorDetails {
            message: format!("Modeling command timed out"),
            source_ranges: vec![source_range],
        }))
    }
}
