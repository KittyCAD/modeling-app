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
use crate::errors::KclErrorDetails;

/// Doesn't actually connect to the engine.
pub struct MockTransport {
    responses: ResponseInformation,
}

impl MockTransport {
    pub fn new(responses: ResponseInformation) -> Self {
        Self { responses }
    }

    fn empty_bounding_box() -> Result<OkModelingCmdResponse, KclError> {
        // The mock has no geometry. Return a valid, zero-extent box so callers
        // can exercise their no-bounds fallback.
        serde_json::from_value(serde_json::json!({
            "center": { "x": 0.0, "y": 0.0, "z": 0.0 },
            "dimensions": { "x": 0.0, "y": 0.0, "z": 0.0 },
        }))
        .map(OkModelingCmdResponse::BoundingBox)
        .map_err(|error| {
            KclError::new_internal(KclErrorDetails::new(
                format!("Invalid mock bounding box response: {error}"),
                vec![],
            ))
        })
    }

    fn response_for_cmd(id: Uuid, cmd: WebSocketRequest) -> Result<WebSocketResponse, KclError> {
        Ok(match cmd {
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
                            response: if matches!(request.cmd, ModelingCmd::BoundingBox(_)) {
                                Self::empty_bounding_box()?
                            } else {
                                OkModelingCmdResponse::Empty {}
                            },
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
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                cmd: ModelingCmd::BoundingBox(_),
                ..
            }) => WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: Self::empty_bounding_box()?,
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
        })
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
        let response = Self::response_for_cmd(cmd_id, cmd)?;
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
        Self::response_for_cmd(id, cmd)
    }

    async fn close(&self) -> Result<(), TransportCloseError> {
        Ok(())
    }
}
