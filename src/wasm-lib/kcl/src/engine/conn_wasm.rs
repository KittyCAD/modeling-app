//! Functions for setting up our WebSocket and WebRTC connections for communications with the
//! engine.
use std::sync::{Arc, Mutex};

use anyhow::Result;
use kittycad::types::{OkWebSocketResponseData, WebSocketRequest};
use wasm_bindgen::prelude::*;

use crate::{
    engine::is_cmd_with_return_values,
    errors::{KclError, KclErrorDetails},
};

#[wasm_bindgen(module = "/../../lang/std/engineConnection.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type EngineCommandManager;

    #[wasm_bindgen(method, js_name = sendModelingCommandFromWasm, catch)]
    fn send_modeling_cmd_from_wasm(
        this: &EngineCommandManager,
        id: String,
        rangeStr: String,
        cmdStr: String,
    ) -> Result<js_sys::Promise, js_sys::Error>;
}

#[derive(Debug, Clone)]
pub struct EngineConnection {
    manager: Arc<EngineCommandManager>,
    batch: Arc<Mutex<Vec<WebSocketRequest>>>,
}

// Safety: WebAssembly will only ever run in a single-threaded context.
unsafe impl Send for EngineConnection {}
unsafe impl Sync for EngineConnection {}

impl EngineConnection {
    pub async fn new(manager: EngineCommandManager) -> Result<EngineConnection, JsValue> {
        Ok(EngineConnection {
            manager: Arc::new(manager),
            batch: Arc::new(Mutex::new(Vec::new())),
        })
    }
}

#[async_trait::async_trait]
impl crate::engine::EngineManager for EngineConnection {
    async fn send_modeling_cmd(
        &self,
        flush_batch: bool,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<kittycad::types::OkWebSocketResponseData, KclError> {
        let req = WebSocketRequest::ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id,
        };

        if !flush_batch {
            self.batch.lock().unwrap().push(req);
        }

        // If the batch only has this one command that expects a return value,
        // fire it right away, or if we want to flush batch queue.
        let is_sending = (is_cmd_with_return_values(&cmd) && self.batch.lock().unwrap().len() == 1)
            || flush_batch
            || is_cmd_with_return_values(&cmd);

        // Return a fake modeling_request empty response.
        if !is_sending {
            return Ok(OkWebSocketResponseData::Modeling {
                modeling_response: kittycad::types::OkModelingCmdResponse::Empty {},
            });
        }

        let batched_requests = WebSocketRequest::ModelingCmdBatchReq {
            requests: self.batch.lock().unwrap().iter().fold(vec![], |mut acc, val| {
                let WebSocketRequest::ModelingCmdReq { cmd, cmd_id } = val else {
                    return acc;
                };
                acc.push(kittycad::types::ModelingCmdReq {
                    cmd: cmd.clone(),
                    cmd_id: *cmd_id,
                });
                acc
            }),
            batch_id: uuid::Uuid::new_v4(),
        };

        let final_req = if self.batch.lock().unwrap().len() == 1 {
            // We can unwrap here because we know the batch has only one element.
            self.batch.lock().unwrap().first().unwrap().clone()
        } else {
            batched_requests
        };

        // Throw away the old batch queue.
        self.batch.lock().unwrap().clear();

        // We pop off the responses to cleanup our mappings.
        let id_final = match final_req {
            WebSocketRequest::ModelingCmdBatchReq { requests: _, batch_id } => batch_id,
            WebSocketRequest::ModelingCmdReq { cmd: _, cmd_id } => cmd_id,
            _ => {
                return Err(KclError::Engine(KclErrorDetails {
                    message: format!("The final request is not a modeling command: {:?}", final_req),
                    source_ranges: vec![source_range],
                }));
            }
        };

        let source_range_str = serde_json::to_string(&source_range).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to serialize source range: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;
        let cmd_str = serde_json::to_string(&final_req).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to serialize modeling command: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        let promise = self
            .manager
            .send_modeling_cmd_from_wasm(id_final.to_string(), source_range_str, cmd_str)
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: e.to_string().into(),
                    source_ranges: vec![source_range],
                })
            })?;

        let value = crate::wasm::JsFuture::from(promise).await.map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to wait for promise from engine: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        // Parse the value as a string.
        let s = value.as_string().ok_or_else(|| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to get string from response from engine: `{:?}`", value),
                source_ranges: vec![source_range],
            })
        })?;

        let modeling_result: kittycad::types::OkWebSocketResponseData = serde_json::from_str(&s).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to deserialize response from engine: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        Ok(modeling_result)
    }
}
