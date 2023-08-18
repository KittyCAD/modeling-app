//! Functions for managing engine communications.

use wasm_bindgen::prelude::*;

#[cfg(feature = "noweb")]
#[cfg(not(test))]
pub mod conn_noweb;
#[cfg(feature = "noweb")]
#[cfg(not(test))]
pub use conn_noweb::EngineConnection;

#[cfg(feature = "web")]
#[cfg(not(test))]
pub mod conn_web;
#[cfg(feature = "web")]
#[cfg(not(test))]
pub use conn_web::EngineConnection;

#[cfg(test)]
pub mod conn_mock;
#[cfg(test)]
pub use conn_mock::EngineConnection;

use crate::executor::SourceRange;

#[derive(Debug)]
#[wasm_bindgen]
pub struct EngineManager {
    connection: EngineConnection,
}

#[wasm_bindgen]
impl EngineManager {
    #[wasm_bindgen(constructor)]
    pub async fn new(conn_str: &str, auth_token: &str, origin: &str) -> EngineManager {
        EngineManager {
            // TODO: fix unwrap.
            connection: EngineConnection::new(conn_str, auth_token, origin)
                .await
                .unwrap(),
        }
    }

    pub fn send_scene_cmd(&mut self, id_str: &str, cmd_str: &str) -> Result<(), String> {
        let id = uuid::Uuid::parse_str(id_str).map_err(|e| e.to_string())?;
        let cmd = serde_json::from_str(cmd_str).map_err(|e| e.to_string())?;
        match cmd {
            kittycad::types::ModelingCmd::HighlightSetEntity { .. }
            | kittycad::types::ModelingCmd::CameraDragMove { .. } => {
                self.connection
                    .send_lossy_cmd(id, SourceRange::default(), cmd)
                    .map_err(String::from)?;
            }
            _ => {
                self.connection
                    .send_modeling_cmd(id, SourceRange::default(), cmd)
                    .map_err(String::from)?;
            }
        }

        Ok(())
    }

    pub fn send_modeling_cmd(&mut self, id_str: &str, cmd_str: &str) -> Result<(), String> {
        let id = uuid::Uuid::parse_str(id_str).map_err(|e| e.to_string())?;
        let cmd = serde_json::from_str(cmd_str).map_err(|e| e.to_string())?;
        match cmd {
            kittycad::types::ModelingCmd::HighlightSetEntity { .. }
            | kittycad::types::ModelingCmd::CameraDragMove { .. } => {
                self.connection
                    .send_lossy_cmd(id, SourceRange::default(), cmd)
                    .map_err(String::from)?;
            }
            _ => {
                self.connection
                    .send_modeling_cmd(id, SourceRange::default(), cmd)
                    .map_err(String::from)?;
            }
        }

        Ok(())
    }
}
