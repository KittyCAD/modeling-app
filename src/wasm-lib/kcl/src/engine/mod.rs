//! Functions for managing engine communications.

#[cfg(not(target_arch = "wasm32"))]
#[cfg(feature = "engine")]
pub mod conn;
pub mod conn_mock;
#[cfg(target_arch = "wasm32")]
#[cfg(feature = "engine")]
pub mod conn_wasm;

#[async_trait::async_trait]
pub trait EngineManager: std::fmt::Debug + Send + Sync + 'static {
    /// Send a modeling command and wait for the response message.
    async fn send_modeling_cmd(
        &self,
        flush_batch: bool,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError>;
}
