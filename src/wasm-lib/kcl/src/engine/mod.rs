//! Functions for managing engine communications.

#[cfg(target_arch = "wasm32")]
#[cfg(not(test))]
#[cfg(feature = "engine")]
use wasm_bindgen::prelude::*;

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
#[cfg(not(feature = "engine"))]
#[cfg(not(test))]
pub use conn_mock::EngineConnection;

#[cfg(target_arch = "wasm32")]
#[cfg(not(test))]
#[derive(Debug)]
#[wasm_bindgen]
pub struct EngineManager {
    connection: EngineConnection,
}
#[cfg(target_arch = "wasm32")]
#[cfg(not(test))]
#[cfg(feature = "engine")]
#[wasm_bindgen]
impl EngineManager {
    #[wasm_bindgen(constructor)]
    pub async fn new(manager: conn_wasm::EngineCommandManager) -> EngineManager {
        EngineManager {
            // This unwrap is safe because the connection is always created.
            connection: EngineConnection::new(manager).await.unwrap(),
        }
    }

    pub fn send_modeling_cmd(&mut self, id_str: &str, cmd_str: &str) -> Result<(), String> {
        let id = uuid::Uuid::parse_str(id_str).map_err(|e| e.to_string())?;
        let cmd = serde_json::from_str(cmd_str).map_err(|e| e.to_string())?;
        self.connection
            .send_modeling_cmd(id, crate::executor::SourceRange::default(), cmd)
            .map_err(String::from)?;

        Ok(())
    }
}
