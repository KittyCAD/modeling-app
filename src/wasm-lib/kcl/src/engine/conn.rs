//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use std::sync::Arc;

use anyhow::Result;
use futures::{SinkExt, StreamExt};
use kittycad::types::{OkWebSocketResponseData, WebSocketRequest, WebSocketResponse};
use tokio_tungstenite::tungstenite::Message as WsMsg;

use crate::errors::{KclError, KclErrorDetails};

#[derive(Debug)]
pub struct EngineConnection {
    tcp_write:
        futures::stream::SplitSink<tokio_tungstenite::WebSocketStream<reqwest::Upgraded>, WsMsg>,
    tcp_read_handle: tokio::task::JoinHandle<Result<()>>,
    export_notifier: Arc<tokio::sync::Notify>,
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
        let msg = self.stream.next().await.unwrap()?;
        let msg: WebSocketResponse = match msg {
            WsMsg::Text(text) => serde_json::from_str(&text)?,
            WsMsg::Binary(bin) => bson::from_slice(&bin)?,
            other => anyhow::bail!("Unexpected websocket message from server: {}", other),
        };
        Ok(msg)
    }
}

impl EngineConnection {
    pub async fn new(ws: reqwest::Upgraded, export_dir: &str) -> Result<EngineConnection> {
        // Make sure the export directory exists and that it is a directory.
        let export_dir = std::path::Path::new(export_dir).to_owned();
        if !export_dir.exists() {
            anyhow::bail!("Export directory does not exist: {}", export_dir.display());
        }
        // Make sure it is a directory.
        if !export_dir.is_dir() {
            anyhow::bail!(
                "Export directory is not a directory: {}",
                export_dir.display()
            );
        }

        let ws_stream = tokio_tungstenite::WebSocketStream::from_raw_socket(
            ws,
            tokio_tungstenite::tungstenite::protocol::Role::Client,
            None,
        )
        .await;

        let (tcp_write, tcp_read) = ws_stream.split();

        let mut tcp_read = TcpRead { stream: tcp_read };

        let export_notifier = Arc::new(tokio::sync::Notify::new());
        let export_notifier_clone = export_notifier.clone();

        let tcp_read_handle = tokio::spawn(async move {
            // Get Websocket messages from API server
            loop {
                match tcp_read.read().await {
                    Ok(ws_resp) => {
                        if !ws_resp.success {
                            println!("got ws errors: {:?}", ws_resp.errors);
                            export_notifier.notify_one();
                            continue;
                        }

                        if let Some(msg) = ws_resp.resp {
                            match msg {
                                OkWebSocketResponseData::IceServerInfo { ice_servers } => {
                                    println!("got ice server info: {:?}", ice_servers);
                                }
                                OkWebSocketResponseData::SdpAnswer { answer } => {
                                    println!("got sdp answer: {:?}", answer);
                                }
                                OkWebSocketResponseData::TrickleIce { candidate } => {
                                    println!("got trickle ice: {:?}", candidate);
                                }
                                OkWebSocketResponseData::Modeling { .. } => {}
                                OkWebSocketResponseData::Export { files } => {
                                    // Save the files to our export directory.
                                    for file in files {
                                        let path = export_dir.join(file.name);
                                        std::fs::write(&path, file.contents)?;
                                        println!("Wrote file: {}", path.display());
                                    }

                                    // Tell the export notifier that we have new files.
                                    export_notifier.notify_one();
                                }
                            }
                        }
                    }
                    Err(e) => {
                        println!("got ws error: {:?}", e);
                        export_notifier.notify_one();
                        continue;
                    }
                }
            }
        });

        Ok(EngineConnection {
            tcp_write,
            tcp_read_handle,
            export_notifier: export_notifier_clone,
        })
    }

    pub async fn wait_for_files(&self) {
        self.export_notifier.notified().await;
    }

    pub async fn tcp_send(&mut self, msg: WebSocketRequest) -> Result<()> {
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
            self.tcp_send(WebSocketRequest::ModelingCmdReq { cmd, cmd_id: id }),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::executor::{execute, BodyType, ProgramMemory, SourceRange};

    pub async fn parse_execute_export(code: &str) -> Result<()> {
        let tokens = crate::tokeniser::lexer(code);
        let export_dir_str = "/tmp/";
        let program = crate::parser::abstract_syntax_tree(&tokens)?;
        let mut mem: ProgramMemory = Default::default();
        let mut engine = EngineConnection::new(
            "wss://api.dev.kittycad.io/ws/modeling/commands?webrtc=false",
            std::env::var("KITTYCAD_API_TOKEN").unwrap().as_str(),
            "modeling-app-tests",
            export_dir_str,
        )
        .await?;
        let _ = execute(program, &mut mem, BodyType::Root, &mut engine)?;
        // Send an export request to the engine.
        engine.send_modeling_cmd(
            uuid::Uuid::new_v4(),
            SourceRange::default(),
            kittycad::types::ModelingCmd::Export {
                entity_ids: vec![],
                format: kittycad::types::OutputFormat::Gltf {
                    presentation: kittycad::types::Presentation::Pretty,
                    storage: kittycad::types::Storage::Embedded,
                },
            },
        )?;

        engine.wait_for_files().await;

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_export_file() {
        let ast = r#"const part001 = startSketchAt([-0.01, -0.06])
  |> line([0, 20], %)
  |> line([5, 0], %)
  |> line([-10, 5], %)
  |> close(%)
  |> extrude(4, %)

show(part001)"#;
        parse_execute_export(ast).await.unwrap();

        // Ensure we have a file called "part001.gltf" in the export directory.
        let export_dir = std::path::Path::new("/tmp/");
        let export_file = export_dir.join("part001.gltf");
        assert!(export_file.exists());
        // Make sure the file is not empty.
        assert!(export_file.metadata().unwrap().len() != 0);
    }
}
