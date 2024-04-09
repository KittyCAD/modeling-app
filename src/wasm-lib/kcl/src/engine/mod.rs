//! Functions for managing engine communications.

#[cfg(not(target_arch = "wasm32"))]
#[cfg(feature = "engine")]
pub mod conn;
pub mod conn_mock;
#[cfg(target_arch = "wasm32")]
#[cfg(feature = "engine")]
pub mod conn_wasm;

use std::sync::{Arc, Mutex};

use kittycad::types::{OkWebSocketResponseData, WebSocketRequest};

use crate::errors::{KclError, KclErrorDetails};

#[async_trait::async_trait]
pub trait EngineManager: std::fmt::Debug + Send + Sync + 'static {
    /// Get the batch of commands to be sent to the engine.
    fn batch(&self) -> Arc<Mutex<Vec<(kittycad::types::WebSocketRequest, crate::executor::SourceRange)>>>;

    /// Send a modeling command and wait for the response message.
    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::WebSocketRequest,
        id_to_source_range: std::collections::HashMap<uuid::Uuid, crate::executor::SourceRange>,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError>;

    fn push_to_batch(
        &self,
        cmd_id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) {
        let req = WebSocketRequest::ModelingCmdReq { cmd, cmd_id };
        self.batch().lock().unwrap().push((req, source_range))
    }

    async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError> {
        let req = WebSocketRequest::ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id,
        };

        // Add cmd to the batch.
        self.batch().lock().unwrap().push((req, source_range));

        // If the batch only has this one command that expects a return value,
        // fire it right away, or if we want to flush batch queue.
        let is_sending = is_cmd_with_return_values(&cmd);

        // Return a fake modeling_request empty response.
        if !is_sending {
            return Ok(OkWebSocketResponseData::Modeling {
                modeling_response: kittycad::types::OkModelingCmdResponse::Empty {},
            });
        }

        // Flush the batch queue.
        self.flush_batch(source_range).await
    }

    /// Force flush the batch queue.
    async fn flush_batch(
        &self,
        source_range: crate::executor::SourceRange,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError> {
        // Return early if we have no commands to send.
        if self.batch().lock().unwrap().is_empty() {
            return Ok(OkWebSocketResponseData::Modeling {
                modeling_response: kittycad::types::OkModelingCmdResponse::Empty {},
            });
        }

        let requests = self
            .batch()
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(val, _)| match val {
                WebSocketRequest::ModelingCmdReq { cmd, cmd_id } => Some(kittycad::types::ModelingCmdReq {
                    cmd: cmd.clone(),
                    cmd_id: *cmd_id,
                }),
                _ => None,
            })
            .collect();
        let batched_requests = WebSocketRequest::ModelingCmdBatchReq {
            requests,
            batch_id: uuid::Uuid::new_v4(),
        };

        let final_req = if self.batch().lock().unwrap().len() == 1 {
            // We can unwrap here because we know the batch has only one element.
            self.batch().lock().unwrap().first().unwrap().0.clone()
        } else {
            batched_requests
        };
        // debug_batch(&final_req);

        // Create the map of original command IDs to source range.
        // This is for the wasm side, kurt needs it for selections.
        let mut id_to_source_range = std::collections::HashMap::new();
        for (req, range) in self.batch().lock().unwrap().iter() {
            match req {
                WebSocketRequest::ModelingCmdReq { cmd: _, cmd_id } => {
                    id_to_source_range.insert(*cmd_id, *range);
                }
                _ => {
                    return Err(KclError::Engine(KclErrorDetails {
                        message: format!("The request is not a modeling command: {:?}", req),
                        source_ranges: vec![*range],
                    }));
                }
            }
        }

        // Throw away the old batch queue.
        self.batch().lock().unwrap().clear();

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

        self.inner_send_modeling_cmd(id_final, source_range, final_req, id_to_source_range)
            .await
    }
}

pub fn is_cmd_with_return_values(cmd: &kittycad::types::ModelingCmd) -> bool {
    let (kittycad::types::ModelingCmd::Export { .. }
    | kittycad::types::ModelingCmd::Extrude { .. }
    | kittycad::types::ModelingCmd::DefaultCameraLookAt { .. }
    | kittycad::types::ModelingCmd::DefaultCameraFocusOn { .. }
    | kittycad::types::ModelingCmd::DefaultCameraGetSettings { .. }
    | kittycad::types::ModelingCmd::DefaultCameraPerspectiveSettings { .. }
    | kittycad::types::ModelingCmd::DefaultCameraZoom { .. }
    | kittycad::types::ModelingCmd::SketchModeDisable { .. }
    | kittycad::types::ModelingCmd::ObjectBringToFront { .. }
    | kittycad::types::ModelingCmd::SelectWithPoint { .. }
    | kittycad::types::ModelingCmd::HighlightSetEntity { .. }
    | kittycad::types::ModelingCmd::EntityGetChildUuid { .. }
    | kittycad::types::ModelingCmd::EntityGetNumChildren { .. }
    | kittycad::types::ModelingCmd::EntityGetParentId { .. }
    | kittycad::types::ModelingCmd::EntityGetAllChildUuids { .. }
    | kittycad::types::ModelingCmd::CameraDragMove { .. }
    | kittycad::types::ModelingCmd::CameraDragEnd { .. }
    | kittycad::types::ModelingCmd::SelectGet { .. }
    | kittycad::types::ModelingCmd::Solid3DGetAllEdgeFaces { .. }
    | kittycad::types::ModelingCmd::Solid3DGetAllOppositeEdges { .. }
    | kittycad::types::ModelingCmd::Solid3DGetOppositeEdge { .. }
    | kittycad::types::ModelingCmd::Solid3DGetNextAdjacentEdge { .. }
    | kittycad::types::ModelingCmd::Solid3DGetPrevAdjacentEdge { .. }
    | kittycad::types::ModelingCmd::GetEntityType { .. }
    | kittycad::types::ModelingCmd::CurveGetControlPoints { .. }
    | kittycad::types::ModelingCmd::CurveGetType { .. }
    | kittycad::types::ModelingCmd::MouseClick { .. }
    | kittycad::types::ModelingCmd::TakeSnapshot { .. }
    | kittycad::types::ModelingCmd::PathGetInfo { .. }
    | kittycad::types::ModelingCmd::PathGetCurveUuidsForVertices { .. }
    | kittycad::types::ModelingCmd::PathGetVertexUuids { .. }
    | kittycad::types::ModelingCmd::CurveGetEndPoints { .. }
    | kittycad::types::ModelingCmd::FaceIsPlanar { .. }
    | kittycad::types::ModelingCmd::FaceGetPosition { .. }
    | kittycad::types::ModelingCmd::FaceGetGradient { .. }
    | kittycad::types::ModelingCmd::PlaneIntersectAndProject { .. }
    | kittycad::types::ModelingCmd::ImportFiles { .. }
    | kittycad::types::ModelingCmd::Mass { .. }
    | kittycad::types::ModelingCmd::Volume { .. }
    | kittycad::types::ModelingCmd::Density { .. }
    | kittycad::types::ModelingCmd::SurfaceArea { .. }
    | kittycad::types::ModelingCmd::CenterOfMass { .. }
    | kittycad::types::ModelingCmd::GetSketchModePlane { .. }
    | kittycad::types::ModelingCmd::EntityGetDistance { .. }
    | kittycad::types::ModelingCmd::EntityLinearPattern { .. }
    | kittycad::types::ModelingCmd::EntityCircularPattern { .. }
    | kittycad::types::ModelingCmd::Solid3DGetExtrusionFaceInfo { .. }) = cmd
    else {
        return false;
    };

    true
}

#[allow(dead_code)] // Only used in debugging.
fn debug_batch(msg: &WebSocketRequest) {
    if let WebSocketRequest::ModelingCmdReq { cmd, .. } = msg {
        println!("[ {:?} ]", cmd);
        return;
    }
    let WebSocketRequest::ModelingCmdBatchReq { requests, .. } = msg else {
        dbg!(&msg);
        panic!("msg is not batch")
    };
    let names: Vec<_> = requests.iter().map(|req| format!("{:?}", req.cmd)).collect();
    println!("[ {} ]", names.join(", "))
}
