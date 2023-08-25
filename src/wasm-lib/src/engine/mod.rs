//! Functions for managing engine communications.

use wasm_bindgen::prelude::*;

#[cfg(feature = "noweb")]
pub mod conn_noweb;
#[cfg(feature = "noweb")]
pub use conn_noweb::EngineConnection;

#[cfg(feature = "web")]
#[cfg(not(test))]
pub mod conn_web;
#[cfg(feature = "web")]
#[cfg(not(test))]
pub use conn_web::EngineConnection;

//#[cfg(test)]
//pub mod conn_mock;
//#[cfg(test)]
//pub use conn_mock::EngineConnection;

use crate::executor::SourceRange;

#[derive(Debug)]
#[wasm_bindgen]
pub struct EngineManager {
    connection: EngineConnection,
}

#[wasm_bindgen]
impl EngineManager {
    #[cfg(feature = "web")]
    #[cfg(not(test))]
    #[wasm_bindgen(constructor)]
    pub async fn new(manager: conn_web::EngineCommandManager) -> EngineManager {
        EngineManager {
            // This unwrap is safe because the connection is always created.
            connection: EngineConnection::new(manager).await.unwrap(),
        }
    }

    #[cfg(not(feature = "web"))]
    #[wasm_bindgen(constructor)]
    pub async fn new(
        conn_str: &str,
        auth_token: &str,
        origin: &str,
        export_dir: &str,
    ) -> EngineManager {
        EngineManager {
            // TODO: fix unwrap.
            connection: EngineConnection::new(conn_str, auth_token, origin, export_dir)
                .await
                .unwrap(),
        }
    }

    pub fn send_modeling_cmd(&mut self, id_str: &str, cmd_str: &str) -> Result<(), String> {
        let id = uuid::Uuid::parse_str(id_str).map_err(|e| e.to_string())?;
        let cmd = serde_json::from_str(cmd_str).map_err(|e| e.to_string())?;
        self.connection
            .send_modeling_cmd(id, SourceRange::default(), cmd)
            .map_err(String::from)?;

        Ok(())
    }
}
