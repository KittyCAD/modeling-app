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
    got_ice_servers: Arc<tokio::sync::Notify>,
    global_ice_servers: Arc<Mutex<Vec<RTCIceServer>>>,
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
        let got_ice_servers_tx = Arc::new(tokio::sync::Notify::new());
        let got_ice_servers = got_ice_servers_tx.clone();
        let global_ice_servers = Arc::new(Mutex::new(vec![]));
        let cloned_ice_servers = global_ice_servers.clone();

        let tcp_read_handle = tokio::spawn(async move {
            // Get Websocket messages from API server
            while let Ok(msg) = tcp_read.read().await {
                match msg {
                    WebSocketResponses::IceServerInfo { ice_servers } => {
                        let mut is = cloned_ice_servers.lock().await;
                        *is = ice_servers
                                .iter()
                                .map(|s| webrtc::ice_transport::ice_server::RTCIceServer {
                                    urls: s.urls.clone(),
                                    username: s.username.clone().unwrap_or_default(),
                                    credential: s.credential.clone().unwrap_or_default(),
                                    credential_type:
                                        webrtc::ice_transport::ice_credential_type::RTCIceCredentialType::Password,
                                })
                                .collect();
                        println!("got ice servers: {:?}", cloned_ice_servers);
                        // Notify the other task that we got the ICE servers.
                        got_ice_servers_tx.notify_one();
                    }
                    WebSocketResponses::SdpAnswer { answer } => {
                        println!("got sdp answer: {:?}", answer);
                    }
                    WebSocketResponses::TrickleIce { candidate } => {
                        println!("got trickle ice: {:?}", candidate);
                    }
                    WebSocketResponses::Modeling { .. } => {}
                    WebSocketResponses::Export { .. } => {}
                }
            }
        });

        Ok(EngineConnection {
            tcp_write,
            tcp_read_handle,
            got_ice_servers,
            global_ice_servers,
        })
    }

    pub async fn tcp_send(&mut self, msg: WebSocketMessages) -> Result<()> {
        let msg = serde_json::to_string(&msg)?;
        self.tcp_write.send(WsMsg::Text(msg)).await?;

        Ok(())
    }

    pub async fn setup(&mut self) -> Result<()> {
        // Create a MediaEngine object to configure the supported codec
        let mut m = webrtc::api::media_engine::MediaEngine::default();

        // Start the webrtc stuff.
        // Setup the codecs you want to use.
        m.register_codec(
            webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecParameters {
                capability: webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability {
                    mime_type: webrtc::api::media_engine::MIME_TYPE_H264.to_owned(),
                    ..Default::default()
                },
                payload_type: 102,
                ..Default::default()
            },
            webrtc::rtp_transceiver::rtp_codec::RTPCodecType::Video,
        )?;

        let mut registry = webrtc::interceptor::registry::Registry::new();

        // Use the default set of Interceptors
        registry =
            webrtc::api::interceptor_registry::register_default_interceptors(registry, &mut m)?;

        // Create the API object with the MediaEngine
        let api = webrtc::api::APIBuilder::new()
            .with_media_engine(m)
            .with_interceptor_registry(registry)
            .build();

        // Wait until we get the ICE servers from the server.
        self.got_ice_servers.notified().await;

        // Prepare the configuration.
        let ice_servers = self.global_ice_servers.lock().await.clone();
        let config = webrtc::peer_connection::configuration::RTCConfiguration {
            ice_servers,
            ice_transport_policy:
                webrtc::peer_connection::policy::ice_transport_policy::RTCIceTransportPolicy::Relay,
            ..Default::default()
        };

        // Create a new RTCPeerConnection
        let peer_connection = Arc::new(api.new_peer_connection(config).await?);

        // Allow us to receive 1 audio track, and 1 video track
        peer_connection
            .add_transceiver_from_kind(
                webrtc::rtp_transceiver::rtp_codec::RTPCodecType::Video,
                None,
            )
            .await?;

        // Continue setting up webRTC stuff.
        // Set the handler for ICE connection state
        // This will notify you when the peer has connected/disconnected
        peer_connection.on_ice_connection_state_change(Box::new(
            move |connection_state: webrtc::ice_transport::ice_connection_state::RTCIceConnectionState| {
                println!("Connection State has changed {connection_state}");

                if connection_state == webrtc::ice_transport::ice_connection_state::RTCIceConnectionState::Connected {
                    println!("Ctrl+C the remote client to stop");
                } else if connection_state == webrtc::ice_transport::ice_connection_state::RTCIceConnectionState::Failed {
                    panic!("Connection failed");
                }
                Box::pin(async {})
            }
        ));

        let offer = peer_connection.create_offer(None).await?;
        // Send the offer back to the remote.
        self.tcp_send(WebSocketMessages::SdpOffer {
            offer: kittycad::types::RtcSessionDescription {
                type_: match offer.sdp_type {
                    webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Offer => {
                        kittycad::types::RtcSdpType::Offer
                    }
                    webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Pranswer => {
                        kittycad::types::RtcSdpType::Pranswer
                    }
                    webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Answer => {
                        kittycad::types::RtcSdpType::Answer
                    }
                    webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Rollback => {
                        kittycad::types::RtcSdpType::Rollback
                    }
                    webrtc::peer_connection::sdp::sdp_type::RTCSdpType::Unspecified => {
                        kittycad::types::RtcSdpType::Unspecified
                    }
                },
                sdp: offer.sdp.clone(),
            },
        })
        .await?;

        // Set the remote SessionDescription
        peer_connection.set_remote_description(offer).await?;

        // Create an answer
        let answer = peer_connection.create_answer(None).await?;

        // Create channel that is blocked until ICE Gathering is complete
        let mut gather_complete = peer_connection.gathering_complete_promise().await;

        // Sets the LocalDescription, and starts our UDP listeners
        peer_connection.set_local_description(answer).await?;

        // Block until ICE Gathering is complete, disabling trickle ICE
        // we do this because we only can exchange one signaling message
        // in a production application you should exchange ICE Candidates via OnICECandidate
        let _ = gather_complete.recv().await;

        if let Some(local_desc) = peer_connection.local_description().await {
            let _description = serde_json::to_string(&local_desc)?;
        } else {
            anyhow::bail!("Failed to get local description");
        }

        Ok(())
    }

    pub fn send_lossy_cmd(
        &mut self,
        _id: uuid::Uuid,
        _source_range: crate::executor::SourceRange,
        _cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
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
