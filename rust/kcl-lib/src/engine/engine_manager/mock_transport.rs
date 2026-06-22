use std::collections::HashMap;

use kcmc::ok_response::OkModelingCmdResponse;
use kcmc::websocket::BatchResponse;
use kcmc::websocket::ModelingBatch;
use kcmc::websocket::ModelingCmdReq;
use kcmc::websocket::OkWebSocketResponseData;
use kcmc::websocket::SuccessWebSocketResponse;
use kcmc::websocket::WebSocketRequest;
use kcmc::websocket::WebSocketResponse;
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::ImportFiles;
use kittycad_modeling_cmds::ModelingCmd;
use uuid::Uuid;

use super::EngineTransport;
use super::ResponseInformation;
use super::TransportCloseError;
use crate::SourceRange;
use crate::errors::KclError;

/// Doesn't actually connect to the engine.
pub struct MockTransport {
    responses: ResponseInformation,
}

impl MockTransport {
    pub fn new(responses: ResponseInformation) -> Self {
        Self { responses }
    }

    fn response_for_cmd(id: Uuid, cmd: WebSocketRequest) -> WebSocketResponse {
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
                WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::ModelingBatch { responses },
                    success: true,
                })
            }
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                cmd: ModelingCmd::ImportFiles(ImportFiles { .. }),
                cmd_id,
            }) => WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::ImportFiles(
                        kittycad_modeling_cmds::output::ImportFiles::builder()
                            .object_id(cmd_id.into())
                            .build(),
                    ),
                },
                success: true,
            }),
            WebSocketRequest::ModelingCmdReq(_) => WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::Empty {},
                },
                success: true,
            }),
            _ => WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::Empty {},
                },
                success: true,
            }),
        }
    }
}

#[async_trait::async_trait]
impl EngineTransport for MockTransport {
    async fn inner_fire_modeling_cmd(
        &self,
        cmd_id: Uuid,
        _source_range: SourceRange,
        cmd: WebSocketRequest,
        _id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        let response = Self::response_for_cmd(cmd_id, cmd);
        self.responses.add(cmd_id, response).await;

        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: Uuid,
        _source_range: SourceRange,
        cmd: WebSocketRequest,
        _id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        Ok(Self::response_for_cmd(id, cmd))
    }

    async fn close(&self) -> Result<(), TransportCloseError> {
        Ok(())
    }
}
