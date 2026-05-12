//! Native OpenCascade engine backend.
//!
//! The native backend calls the shared C++ OCCT command core through a small C
//! ABI, then maps the protocol result into the strongly typed modeling response
//! shape expected by the KCL executor. The same C++ source is compiled to an
//! Emscripten module for the browser transport.

use std::collections::HashMap;
use std::ffi::{CStr, CString, c_char};
use std::sync::Arc;

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::ok_response::OkModelingCmdResponse;
use kcmc::websocket::BatchResponse;
use kcmc::websocket::ModelingBatch;
use kcmc::websocket::OkWebSocketResponseData;
use kcmc::websocket::SuccessWebSocketResponse;
use kcmc::websocket::WebSocketRequest;
use kcmc::websocket::WebSocketResponse;
use kittycad_modeling_cmds::ImportFiles;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::websocket::ModelingCmdReq;
use kittycad_modeling_cmds::{self as kcmc};
use serde::Deserialize;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::SourceRange;
use crate::engine::AsyncTasks;
use crate::engine::EngineBatchContext;
use crate::engine::EngineStats;
use crate::errors::{KclError, KclErrorDetails};
use crate::exec::DefaultPlanes;
use crate::execution::IdGenerator;

unsafe extern "C" {
    fn zoo_occt_core_start_new_session() -> *mut c_char;
    fn zoo_occt_core_record_rollback_marker(source_range_json: *const c_char) -> *mut c_char;
    fn zoo_occt_core_handle_modeling_command(request_id: *const c_char, request_json: *const c_char) -> *mut c_char;
    fn zoo_occt_core_free(value: *mut c_char);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreResponse {
    ok: bool,
    response: String,
}

#[derive(Debug, Clone)]
pub struct EngineConnection {
    ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>>,
    responses: Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>>,
    /// The default planes for the scene.
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    stats: EngineStats,
    async_tasks: AsyncTasks,
}

impl EngineConnection {
    pub fn new() -> Result<EngineConnection> {
        let connection = EngineConnection {
            ids_of_async_commands: Arc::new(RwLock::new(IndexMap::new())),
            responses: Arc::new(RwLock::new(IndexMap::new())),
            default_planes: Default::default(),
            stats: Default::default(),
            async_tasks: AsyncTasks::new(),
        };
        connection.start_core_session()?;
        Ok(connection)
    }

    fn start_core_session(&self) -> Result<(), KclError> {
        let response = call_core(|| unsafe { zoo_occt_core_start_new_session() }, SourceRange::default())?;
        parse_core_response(&response, SourceRange::default())?;
        Ok(())
    }

    fn send_to_core(
        &self,
        id: Uuid,
        cmd: &WebSocketRequest,
        source_range: SourceRange,
    ) -> Result<CoreResponse, KclError> {
        let request_id = CString::new(id.to_string()).map_err(|e| core_error(e.to_string(), source_range))?;
        let request_json =
            CString::new(serde_json::to_string(cmd).map_err(|e| core_error(e.to_string(), source_range))?)
                .map_err(|e| core_error(e.to_string(), source_range))?;
        let response = call_core(
            || unsafe { zoo_occt_core_handle_modeling_command(request_id.as_ptr(), request_json.as_ptr()) },
            source_range,
        )?;
        parse_core_response(&response, source_range)
    }
}

#[async_trait::async_trait]
impl crate::engine::EngineManager for EngineConnection {
    fn responses(&self) -> Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>> {
        self.responses.clone()
    }

    fn stats(&self) -> &EngineStats {
        &self.stats
    }

    fn ids_of_async_commands(&self) -> Arc<RwLock<IndexMap<Uuid, SourceRange>>> {
        self.ids_of_async_commands.clone()
    }

    fn async_tasks(&self) -> AsyncTasks {
        self.async_tasks.clone()
    }

    fn get_default_planes(&self) -> Arc<RwLock<Option<DefaultPlanes>>> {
        self.default_planes.clone()
    }

    async fn clear_scene_post_hook(
        &self,
        _batch_context: &EngineBatchContext,
        _id_generator: &mut IdGenerator,
        _source_range: SourceRange,
    ) -> Result<(), KclError> {
        Ok(())
    }

    async fn record_rollback_marker(&self, source_range: SourceRange) -> Result<bool, KclError> {
        let source_range_json =
            CString::new(serde_json::to_string(&source_range).map_err(|e| core_error(e.to_string(), source_range))?)
                .map_err(|e| core_error(e.to_string(), source_range))?;
        let response = call_core(
            || unsafe { zoo_occt_core_record_rollback_marker(source_range_json.as_ptr()) },
            source_range,
        )?;
        let core = parse_core_response(&response, source_range)?;
        Ok(core.ok)
    }

    async fn get_debug(&self) -> Option<OkWebSocketResponseData> {
        None
    }

    async fn fetch_debug(&self) -> Result<(), KclError> {
        Ok(())
    }

    async fn inner_fire_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        // Pop off the id we care about.
        self.ids_of_async_commands.write().await.swap_remove(&id);

        // Add the response to our responses.
        let response = self
            .inner_send_modeling_cmd(id, source_range, cmd, id_to_source_range)
            .await?;
        self.responses().write().await.insert(id, response);

        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        _id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        let core = self.send_to_core(id, &cmd, source_range)?;
        match cmd {
            WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
                ref requests,
                batch_id: _,
                responses: _,
            }) => {
                if core.response != "batch" {
                    return Err(core_error(
                        format!("OCCT core returned {:?} for a modeling batch", core.response),
                        source_range,
                    ));
                }
                let mut responses = HashMap::with_capacity(requests.len());
                for request in requests {
                    responses.insert(
                        request.cmd_id,
                        BatchResponse::Success {
                            response: modeling_response_for_command(request.cmd_id.into(), &request.cmd),
                        },
                    );
                }
                Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::ModelingBatch { responses },
                    success: true,
                }))
            }
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq { cmd, cmd_id }) => {
                if core.response != "modeling" {
                    return Err(core_error(
                        format!("OCCT core returned {:?} for a modeling command", core.response),
                        source_range,
                    ));
                }
                Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::Modeling {
                        modeling_response: modeling_response_for_command(cmd_id.into(), &cmd),
                    },
                    success: true,
                }))
            }
            _ => Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::Empty {},
                },
                success: true,
            })),
        }
    }

    async fn close(&self) {}
}

fn modeling_response_for_command(cmd_id: Uuid, cmd: &ModelingCmd) -> OkModelingCmdResponse {
    match cmd {
        ModelingCmd::ImportFiles(ImportFiles { .. }) => OkModelingCmdResponse::ImportFiles(
            kittycad_modeling_cmds::output::ImportFiles::builder()
                .object_id(cmd_id.into())
                .build(),
        ),
        _ => OkModelingCmdResponse::Empty {},
    }
}

fn call_core<F>(call: F, source_range: SourceRange) -> Result<String, KclError>
where
    F: FnOnce() -> *mut c_char,
{
    let raw = call();
    if raw.is_null() {
        return Err(core_error("OCCT command core returned a null response", source_range));
    }

    let value = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
    unsafe { zoo_occt_core_free(raw) };
    Ok(value)
}

fn parse_core_response(response: &str, source_range: SourceRange) -> Result<CoreResponse, KclError> {
    let parsed: CoreResponse = serde_json::from_str(response).map_err(|e| {
        core_error(
            format!("Could not parse OCCT command core response: {e}; response={response}"),
            source_range,
        )
    })?;
    if !parsed.ok {
        return Err(core_error(
            format!("OCCT command core rejected request: {response}"),
            source_range,
        ));
    }
    Ok(parsed)
}

fn core_error(message: impl Into<String>, source_range: SourceRange) -> KclError {
    KclError::new_engine(KclErrorDetails::new(message.into(), vec![source_range]))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use kittycad_modeling_cmds::ModelingCmd;
    use kittycad_modeling_cmds::websocket::{ModelingCmdReq, WebSocketRequest};
    use uuid::Uuid;

    use super::EngineConnection;
    use crate::SourceRange;
    use crate::engine::EngineManager;

    #[tokio::test]
    async fn native_occt_backend_round_trips_through_shared_core() {
        let engine = EngineConnection::new().unwrap();
        let request_id = Uuid::new_v4();
        let response = engine
            .inner_send_modeling_cmd(
                request_id,
                SourceRange::default(),
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                    cmd_id: Uuid::new_v4().into(),
                    cmd: ModelingCmd::SceneClearAll(kittycad_modeling_cmds::SceneClearAll::default()),
                }),
                HashMap::new(),
            )
            .await
            .unwrap();

        assert_eq!(response.request_id(), Some(request_id));
        assert!(response.is_success());
    }
}
