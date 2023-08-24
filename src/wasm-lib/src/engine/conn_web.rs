//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.

use anyhow::Result;
use kittycad::types::WebSocketMessages;
use wasm_bindgen::prelude::*;

use crate::errors::{KclError, KclErrorDetails};

#[wasm_bindgen(module = "/../lang/std/engineConnection.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type EngineCommandManager;

    #[wasm_bindgen(method)]
    fn sendModelingCommandFromWasm(
        this: &EngineCommandManager,
        id: String,
        rangeStr: String,
        cmdStr: String,
    );
}

#[derive(Debug, Clone)]
pub struct EngineConnection {
    manager: EngineCommandManager,
}

impl EngineConnection {
    pub async fn new(manager: EngineCommandManager) -> Result<EngineConnection, JsValue> {
        Ok(EngineConnection { manager })
    }

    pub fn send_modeling_cmd(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
        let source_range_str = serde_json::to_string(&source_range).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to serialize source range: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;
        let ws_msg = WebSocketMessages::ModelingCmdReq { cmd, cmd_id: id };
        let cmd_str = serde_json::to_string(&ws_msg).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to serialize modeling command: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;
        self.manager
            .sendModelingCommandFromWasm(id.to_string(), source_range_str, cmd_str);
        Ok(())
    }
}

/*use anyhow::Result;
use kittycad::types::{WebSocketMessages, WebSocketResponses};
use wasm_bindgen::prelude::*;
use web_sys::{CloseEvent, ErrorEvent, MessageEvent, RtcDataChannel, RtcPeerConnection, WebSocket};

use crate::errors::{KclError, KclErrorDetails};

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[derive(Debug, Clone)]
pub struct EngineConnection {
    ws: WebSocket,
    pc: RtcPeerConnection,
    lossy_data_channel: RtcDataChannel,

    ready: bool,
}

impl EngineConnection {
    pub async fn new(
        conn_str: &str,
        auth_token: &str,
        _origin: &str,
    ) -> Result<EngineConnection, JsValue> {
        // Setup the websocket connection.
        let ws = WebSocket::new(conn_str)?;

        // Setup the WebRTC connection.
        let pc = RtcPeerConnection::new()?;
        let lossy_data_channel = pc.create_data_channel("unreliable_modeling_cmds");

        let cloned_ws = ws.clone();
        let cloned_auth_token = auth_token.to_owned();
        let onopen_callback = Closure::<dyn FnMut()>::new(move || {
            println!("Connected to websocket, waiting for ICE servers");

            // Send our token for auth.
            cloned_ws
                .send_with_str(&cloned_auth_token)
                .expect("failed to send auth token");
        });
        ws.set_onopen(Some(onopen_callback.as_ref().unchecked_ref()));
        onopen_callback.forget();

        let onerror_callback = Closure::<dyn FnMut(_)>::new(move |e: ErrorEvent| {
            console_log!("error event: {:?}", e);
        });
        ws.set_onerror(Some(onerror_callback.as_ref().unchecked_ref()));
        onerror_callback.forget();

        // For small binary messages, like CBOR, Arraybuffer is more efficient than Blob handling
        // Export is huge so let's use Blob.
        ws.set_binary_type(web_sys::BinaryType::Blob);

        let engine_conn = EngineConnection {
            ws,
            pc,
            lossy_data_channel,
            ready: false,
        };

        let mut cloned_engine_conn = engine_conn.clone();
        let onclose_callback = Closure::<dyn FnMut(_)>::new(move |e: CloseEvent| {
            console_log!("close event: {:?}", e);
            cloned_engine_conn
                .close()
                .expect("failed to close engine connection");
        });
        engine_conn
            .ws
            .set_onclose(Some(onclose_callback.as_ref().unchecked_ref()));
        onclose_callback.forget();

        let mut cloned_engine_conn = engine_conn.clone();
        let onmessage_callback = Closure::<dyn FnMut(_)>::new(move |msg: MessageEvent| {
            // Parse the message as our types.
            let msg = match parse_message(msg) {
                Ok(msg) => msg,
                Err(e) => {
                    console_log!("Failed to parse message: {:?}", e);
                    return;
                }
            };

            match msg {
                WebSocketResponses::IceServerInfo { ice_servers } => {
                    // When we set the Configuration, we want to always force
                    // iceTransportPolicy to 'relay', since we know the topology
                    // of the ICE/STUN/TUN server and the engine. We don't wish to
                    // talk to the engine in any configuration /other/ than relay
                    // from a infra POV.
                    let mut config = web_sys::RtcConfiguration::new();
                    let converted_ice_servers = js_sys::Array::new();
                    for server in ice_servers {
                        let mut ice_server = web_sys::RtcIceServer::new();
                        let urls = js_sys::Array::new();
                        for url in server.urls {
                            urls.push(&JsValue::from(url));
                        }
                        ice_server.urls(&urls.into());
                        if let Some(credential) = server.credential {
                            ice_server.credential(&credential);
                        }
                        if let Some(username) = server.username {
                            ice_server.username(&username);
                        }
                        converted_ice_servers.push(&ice_server.into());
                    }
                    config.ice_servers(&converted_ice_servers.into());
                    config.ice_transport_policy(web_sys::RtcIceTransportPolicy::Relay);
                    cloned_engine_conn.pc = web_sys::RtcPeerConnection::new_with_configuration(
                        &config,
                    )
                    .expect("Failed to create RtcPeerConnection with our custom configuration");

                    // We have an ICE Servers set now. We just setConfiguration, so let's
                    // start adding things we care about to the PeerConnection and let
                    // ICE negotiation happen in the background. Everything from here
                    // until the end of this function is setup of our end of the
                    // PeerConnection and waiting for events to fire our callbacks.

                    let mut cloned_engine_conn2 = cloned_engine_conn.clone();
                    let onicecandidate_callback =
                        Closure::<dyn FnMut(_)>::new(move |ev: MessageEvent| {
                            if !cloned_engine_conn2.ready {
                                return;
                            }

                            let ev: web_sys::RtcPeerConnectionIceEvent = ev
                                .dyn_into()
                                .expect("Failed to cast to RtcPeerConnectionIceEvent");

                            if let Some(candidate) = ev.candidate() {
                                console_log!("sending trickle ice candidate");
                                cloned_engine_conn2
                                    .ws_send(WebSocketMessages::TrickleIce {
                                        candidate: kittycad::types::RtcIceCandidateInit {
                                            candidate: candidate.candidate(),
                                            sdp_mid: candidate.sdp_mid(),
                                            sdp_m_line_index: candidate.sdp_m_line_index(),
                                            username_fragment: Default::default(),
                                        },
                                    })
                                    .expect("failed to send trickle ice candidate");
                            }
                        });
                    cloned_engine_conn
                        .pc
                        .set_onicecandidate(Some(onicecandidate_callback.as_ref().unchecked_ref()));
                    onicecandidate_callback.forget();

                    let onconnectionstatechange_callback =
                        Closure::<dyn FnMut(_)>::new(move |e: MessageEvent| {
                            console_log!("connection state changed: {:?}", e);
                        });
                    cloned_engine_conn.pc.set_onconnectionstatechange(Some(
                        onconnectionstatechange_callback.as_ref().unchecked_ref(),
                    ));
                    onconnectionstatechange_callback.forget();

                    // Offer to receive 1 video track
                    cloned_engine_conn.pc.add_transceiver_with_str("video");

                    // Finally (but actually firstly!), to kick things off, we're going to
                    // generate our SDP, set it on our PeerConnection, and let the server
                    // know about our capabilities.
                    let cloned_engine_conn2 = cloned_engine_conn.clone();
                    let create_offer_callback = Closure::<dyn FnMut(_)>::new(move |v: JsValue| {
                        let desc: web_sys::RtcSessionDescriptionInit = v.into();
                        let _ = cloned_engine_conn2.pc.set_local_description(&desc);
                        console_log!("sent sdp_offer begin");
                        let object: js_sys::Object = desc.into();
                        console_log!("got offer object: {:?}", object);
                        /*cloned_engine_conn2
                        .send(WebSocketMessages::SdpOffer {
                            offer: kittycad::types::RtcSessionDescription {
                                sdp: desc.sdp(),
                                type_: kittycad::types::RtcSdpType::Offer,
                            },
                        })
                        .expect("failed to send sdp offer");*/
                    });
                    let create_offer_catch = Closure::<dyn FnMut(_)>::new(move |v: JsValue| {
                        console_log!("Failed to create offer: {:?}", v);
                    });
                    let _ = cloned_engine_conn
                        .pc
                        .create_offer()
                        .then(&create_offer_callback)
                        .catch(&create_offer_catch);
                    create_offer_callback.forget();
                    create_offer_catch.forget();
                }
                WebSocketResponses::SdpAnswer { answer } => {
                    if answer.type_ == kittycad::types::RtcSdpType::Unspecified {
                        console_log!("Received an unspecified rtc sdp answer, ignoring");
                    } else if cloned_engine_conn.pc.signaling_state()
                        != web_sys::RtcSignalingState::Stable
                    {
                        // If the connection is stable, we shouldn't bother updating the
                        // SDP, since we have a stable connection to the backend. If we
                        // need to renegotiate, the whole PeerConnection needs to get
                        // tore down.
                        let mut desc =
                            web_sys::RtcSessionDescriptionInit::new(match answer.type_ {
                                kittycad::types::RtcSdpType::Offer => web_sys::RtcSdpType::Offer,
                                kittycad::types::RtcSdpType::Pranswer => {
                                    web_sys::RtcSdpType::Pranswer
                                }
                                kittycad::types::RtcSdpType::Answer => web_sys::RtcSdpType::Answer,
                                kittycad::types::RtcSdpType::Rollback => {
                                    web_sys::RtcSdpType::Rollback
                                }
                                kittycad::types::RtcSdpType::Unspecified => {
                                    unreachable!(
                                        "Unspecified RtcSdpType should have been handled above"
                                    )
                                }
                            });
                        desc.sdp(answer.sdp.as_str());
                        let _ = cloned_engine_conn.pc.set_remote_description(&desc);
                    }
                }
                WebSocketResponses::TrickleIce { candidate } => {
                    console_log!("got trickle ice candidate: {:?}", candidate);
                    // this.pc?.addIceCandidate(message.candidate as RTCIceCandidateInit)
                    /*let mut candidate_init = web_sys::RtcIceCandidateInit::new(candidate.candidate);
                    cloned_engine_conn
                        .pc
                        .add_ice_candidate_with_opt_rtc_ice_candidate_init(&candidate_init);*/
                    todo!()
                }
                WebSocketResponses::Modeling { .. } => {}
                WebSocketResponses::Export { .. } => {}
            }
        });
        // set message event handler on WebSocket
        engine_conn
            .ws
            .set_onmessage(Some(onmessage_callback.as_ref().unchecked_ref()));
        // forget the callback to keep it alive
        onmessage_callback.forget();

        Ok(engine_conn)
    }

    fn close(&mut self) -> Result<(), JsValue> {
        self.ready = false;
        self.ws.close()?;
        self.pc.close();
        self.lossy_data_channel.close();

        Ok(())
    }

    fn ws_send(&mut self, msg: kittycad::types::WebSocketMessages) -> Result<(), JsValue> {
        self.ws.send_with_str(
            serde_json::to_string(&msg)
                .map_err(|err| JsValue::from(err.to_string()))?
                .as_str(),
        )?;

        Ok(())
    }

    fn lossy_send(&mut self, msg: kittycad::types::WebSocketMessages) -> Result<(), JsValue> {
        self.lossy_data_channel.send_with_str(
            serde_json::to_string(&msg)
                .map_err(|err| JsValue::from(err.to_string()))?
                .as_str(),
        )?;

        Ok(())
    }

    pub fn send_lossy_cmd(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
        self.lossy_send(WebSocketMessages::ModelingCmdReq { cmd, cmd_id: id })
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: format!("Failed to send modeling command: {:?}", e),
                    source_ranges: vec![source_range],
                })
            })?;

        Ok(())
    }

    pub fn send_modeling_cmd(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), KclError> {
        self.ws_send(WebSocketMessages::ModelingCmdReq { cmd, cmd_id: id })
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: format!("Failed to send modeling command: {:?}", e),
                    source_ranges: vec![source_range],
                })
            })?;
        Ok(())
    }
}

fn parse_message(msg: MessageEvent) -> Result<WebSocketResponses> {
    if let Ok(abuf) = msg.data().dyn_into::<js_sys::ArrayBuffer>() {
        let array = js_sys::Uint8Array::new(&abuf);
        Ok(serde_json::from_slice(&array.to_vec())?)
    } else if let Ok(blob) = msg.data().dyn_into::<web_sys::Blob>() {
        let (sender, receiver) = std::sync::mpsc::channel();
        gloo_file::callbacks::read_as_bytes(&blob.into(), move |res| {
            sender.send(res).unwrap();
        });
        let value = receiver.recv()??;
        Ok(serde_json::from_slice(&value)?)
    } else if let Ok(txt) = msg.data().dyn_into::<js_sys::JsString>() {
        console_log!("message event, received Text: {:?}", txt);
        let s = txt
            .as_string()
            .ok_or_else(|| anyhow::anyhow!("Failed to convert JsString: {:?}", txt))?;
        Ok(serde_json::from_str(&s)?)
    } else {
        console_log!("message event, received Unknown: {:?}", msg.data());
        anyhow::bail!("message event, received Unknown: {:?}", msg.data());
    }
}*/
