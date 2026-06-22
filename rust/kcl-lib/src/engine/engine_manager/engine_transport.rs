use std::collections::HashMap;

use anyhow::Result;
use kcmc::websocket::WebSocketRequest;
use kcmc::websocket::WebSocketResponse;
use kittycad_modeling_cmds::{self as kcmc};
use uuid::Uuid;

use crate::KclError;
use crate::SourceRange;
use crate::engine_connection::TransportCloseError;

/// Handles sending requests to the engine, and waiting for responses.
/// Should have at least two implementations:
/// 1. native code on x86/arm with network access
/// 2. wasm in the browser sandbox, using wasm-bindgen to get a handle for
/// sending and receiving data over the websocket.
#[async_trait::async_trait]
pub trait EngineTransport: Send + Sync + 'static {
    /// Send a modeling command without waiting for any response.
    async fn inner_fire_modeling_cmd(
        &self,
        cmd_id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError>;

    /// Send a modeling command, wait for a response.
    async fn inner_send_modeling_cmd(
        &self,
        cmd_id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError>;

    /// If client is reused across sessions, implement this to clear sessions.
    async fn start_new_session(&self, _source_range: SourceRange) -> Result<(), KclError> {
        Ok(())
    }

    /// Close connection to the engine, clean up resources.
    async fn close(&self) -> Result<(), TransportCloseError>;
}
