use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use indexmap::IndexMap;
use kcl_lib::ExecState;
use kcl_lib::ExecutorContext;
use kcl_lib::KclError;
use kcl_lib::SourceRange;
use kcl_lib::engine_connection::EngineTransport;
use kcl_lib::engine_connection::ResponseInformation;
use kcl_lib::engine_connection::SocketHealth;
use kcl_lib::engine_connection::TransportCloseError;
use kcl_lib::engine_connection::UnifiedConnection;
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::ImportFiles;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::websocket::BatchResponse;
use kittycad_modeling_cmds::websocket::ModelingBatch;
use kittycad_modeling_cmds::websocket::ModelingCmdReq;
use kittycad_modeling_cmds::websocket::ModelingSessionData;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::websocket::SuccessWebSocketResponse;
use kittycad_modeling_cmds::websocket::WebSocketRequest;
use kittycad_modeling_cmds::websocket::WebSocketResponse;
use tokio::sync::RwLock;
use uuid::Uuid;

struct Transport;

#[async_trait::async_trait]
impl EngineTransport for Transport {
    async fn inner_fire_modeling_cmd(
        &self,
        _: Uuid,
        _: SourceRange,
        _: WebSocketRequest,
        _: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        _: SourceRange,
        cmd: WebSocketRequest,
        _: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        match cmd {
            WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
                ref requests,
                batch_id: _,
                responses: _,
            }) => {
                let mut responses = HashMap::with_capacity(requests.len());
                for request in requests {
                    responses.insert(
                        request.cmd_id,
                        BatchResponse::Success {
                            response: OkModelingCmdResponse::Empty {},
                        },
                    );
                }
                Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::ModelingBatch { responses },
                    success: true,
                }))
            }
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                cmd: ModelingCmd::ImportFiles(ImportFiles { .. }),
                cmd_id,
            }) => Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::ImportFiles(
                        kcmc::output::ImportFiles::builder().object_id(cmd_id.into()).build(),
                    ),
                },
                success: true,
            })),
            WebSocketRequest::ModelingCmdReq(_) => Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::Empty {},
                },
                success: true,
            })),
            _ => Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::Empty {},
                },
                success: true,
            })),
        }
    }

    async fn close(&self) -> Result<(), TransportCloseError> {
        Ok(())
    }
}

///Converts the given kcl code to an engine test
pub async fn kcl_to_engine_core(code: &str) -> Result<String> {
    let program = kcl_lib::Program::parse_no_errs(code)?;

    let test_source_code = Arc::new(RwLock::new(String::new()));

    let transport = Transport;
    let session_data: Arc<RwLock<Option<ModelingSessionData>>> = Arc::new(RwLock::new(None));
    let ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>> = Arc::new(RwLock::new(IndexMap::new()));
    let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
    let pending_errors = Arc::new(RwLock::new(Vec::new()));
    let responses = ResponseInformation::new(Arc::new(RwLock::new(IndexMap::new())));

    let connection = UnifiedConnection::builder()
        .transport(Arc::new(Box::new(transport)))
        .session_data(session_data)
        .pending_errors(pending_errors)
        .responses(responses)
        .ids_of_async_commands(ids_of_async_commands)
        .socket_health(socket_health)
        .build();
    let ctx = ExecutorContext::new_forwarded_mock(Arc::new(connection));
    ctx.run(&program, &mut ExecState::new(&ctx)).await?;

    Ok(test_source_code.read().await.clone())
}
