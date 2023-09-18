//! Functions for managing engine communications.

#[cfg(not(target_arch = "wasm32"))]
#[cfg(not(test))]
#[cfg(feature = "engine")]
pub mod conn;
#[cfg(not(target_arch = "wasm32"))]
#[cfg(not(test))]
#[cfg(feature = "engine")]
pub use conn::EngineConnection;

#[cfg(target_arch = "wasm32")]
#[cfg(not(test))]
#[cfg(feature = "engine")]
pub mod conn_wasm;
#[cfg(target_arch = "wasm32")]
#[cfg(not(test))]
#[cfg(feature = "engine")]
pub use conn_wasm::EngineConnection;

#[cfg(test)]
pub mod conn_mock;
#[cfg(test)]
pub use conn_mock::EngineConnection;

#[cfg(not(feature = "engine"))]
#[cfg(not(test))]
pub mod conn_mock;
use anyhow::Result;
#[cfg(not(feature = "engine"))]
#[cfg(not(test))]
pub use conn_mock::EngineConnection;

#[async_trait::async_trait(?Send)]
pub trait EngineManager {
    /// Send a modeling command.
    /// Do not wait for the response message.
    fn send_modeling_cmd(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<(), crate::errors::KclError>;

    /// Send a modeling command and wait for the response message, but block.
    fn send_modeling_cmd_get_response_blocking(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError>;

    /// Send a modeling command and wait for the response message.
    async fn send_modeling_cmd_get_response(
        &mut self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError>;
}
