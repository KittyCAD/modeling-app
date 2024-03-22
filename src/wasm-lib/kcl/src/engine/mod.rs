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
    /// Tell the EngineManager there will be no more commands.
    /// We send a "dummy command" to signal EngineConnection that we're
    /// at the end of the program and there'll be no more requests.
    /// This means in tests, where it's impossible to look ahead, we'll need to
    /// add this to mark the end of commands.
    /// In compiled KCL tests, it will be auto-inserted.
    async fn signal_end(&self) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError> {
        self.send_modeling_cmd(
            // THE NIL UUID IS THE SIGNAL OF THE END OF TIMES FOR THIS POOR PROGRAM.
            uuid::Uuid::nil(),
            // This will be ignored.
            crate::executor::SourceRange([0, 0]),
            // This will be ignored. It was one I found with no fields.
            kittycad::types::ModelingCmd::EditModeExit {},
        )
        .await
    }

    /// Send a modeling command and wait for the response message.
    async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError>;
}
