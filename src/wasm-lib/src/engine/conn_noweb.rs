//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use std::sync::Arc;

use anyhow::Result;
use async_mutex::Mutex;
use futures::{SinkExt, StreamExt};
use kittycad::types::{WebSocketMessages, WebSocketResponses};
use tokio_tungstenite::tungstenite::Message as WsMsg;
use webrtc::ice_transport::ice_server::RTCIceServer;

use crate::errors::{KclError, KclErrorDetails};

#[derive(Debug)]
pub struct EngineConnection {
    tcp_write: futures::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        WsMsg,
    >,
    tcp_read_handle: tokio::task::JoinHandle<()>,
}

impl Drop for EngineConnection {
    fn drop(&mut self) {
        // Drop the read handle.
        self.tcp_read_handle.abort();
    }
}

pub struct TcpRead {
    stream: futures::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
}

impl TcpRead {
    pub async fn read(&mut self) -> Result<WebSocketResponses> {
        let msg = self.stream.next().await.unwrap()?;
        let msg = match msg {
            WsMsg::Text(text) => text,
            WsMsg::Binary(bin) => bincode::deserialize(&bin)?,
            other => anyhow::bail!("Unexpected websocket message from server: {}", other),
        };
        let msg = serde_json::from_str::<WebSocketResponses>(&msg)?;
        Ok(msg)
    }
}

impl EngineConnection {
    pub async fn new(conn_str: &str, auth_token: &str, origin: &str) -> Result<EngineConnection> {
        let method = http::Method::GET.to_string();
        let key = tokio_tungstenite::tungstenite::handshake::client::generate_key();

        // Establish a websocket connection.
        let (ws_stream, _) = tokio_tungstenite::connect_async(httparse::Request {
            method: Some(&method),
            path: Some(conn_str),
            // TODO pass in the origin from elsewhere.
            headers: &mut websocket_headers(auth_token, &key, origin),
            version: Some(1), // HTTP/1.1
        })
        .await?;

        let (tcp_write, tcp_read) = ws_stream.split();

        let mut tcp_read = TcpRead { stream: tcp_read };

        Ok(EngineConnection {
            tcp_write,
            tcp_read_handle,
        })
    }

    pub async fn tcp_send(&mut self, msg: WebSocketMessages) -> Result<()> {
        let msg = serde_json::to_string(&msg)?;
        self.tcp_write.send(WsMsg::Text(msg)).await?;

        Ok(())
    }

    pub fn send_modeling_cmd(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
        futures::executor::block_on(
            self.tcp_send(WebSocketMessages::ModelingCmdReq { cmd, cmd_id: id }),
        )
        .map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to send modeling command: {}", e),
                source_ranges: vec![source_range],
            })
        })?;
        Ok(())
    }
}

/// Headers for starting a websocket session with api-deux.
fn websocket_headers<'a>(
    token: &'a str,
    key: &'a str,
    origin: &'a str,
) -> [httparse::Header<'a>; 6] {
    [
        httparse::Header {
            name: "Authorization",
            value: token.as_bytes(),
        },
        httparse::Header {
            name: "Connection",
            value: b"Upgrade",
        },
        httparse::Header {
            name: "Upgrade",
            value: b"websocket",
        },
        httparse::Header {
            name: "Sec-WebSocket-Version",
            value: b"13",
        },
        httparse::Header {
            name: "Sec-WebSocket-Key",
            value: key.as_bytes(),
        },
        httparse::Header {
            name: "Host",
            value: origin.as_bytes(),
        },
    ]
}
