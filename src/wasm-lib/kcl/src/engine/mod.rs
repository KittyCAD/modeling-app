//! Functions for managing engine communications.

#[cfg(not(target_arch = "wasm32"))]
#[cfg(feature = "engine")]
pub mod conn;
pub mod conn_mock;
#[cfg(target_arch = "wasm32")]
#[cfg(feature = "engine")]
pub mod conn_wasm;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use kittycad::types::{Color, ModelingCmd, OkWebSocketResponseData, WebSocketRequest};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{DefaultPlanes, Point3d},
};

#[async_trait::async_trait]
pub trait EngineManager: std::fmt::Debug + Send + Sync + 'static {
    /// Get the batch of commands to be sent to the engine.
    fn batch(&self) -> Arc<Mutex<Vec<(kittycad::types::WebSocketRequest, crate::executor::SourceRange)>>>;

    /// Get the default planes.
    async fn default_planes(
        &self,
        _source_range: crate::executor::SourceRange,
    ) -> Result<DefaultPlanes, crate::errors::KclError>;

    /// Helpers to be called after clearing a scene.
    /// (These really only apply to wasm for now.
    async fn clear_scene_post_hook(
        &self,
        source_range: crate::executor::SourceRange,
    ) -> Result<(), crate::errors::KclError>;

    /// Send a modeling command and wait for the response message.
    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::WebSocketRequest,
        id_to_source_range: std::collections::HashMap<uuid::Uuid, crate::executor::SourceRange>,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError>;

    async fn clear_scene(&self, source_range: crate::executor::SourceRange) -> Result<(), crate::errors::KclError> {
        self.send_modeling_cmd(
            uuid::Uuid::new_v4(),
            source_range,
            kittycad::types::ModelingCmd::SceneClearAll {},
        )
        .await?;

        // Flush the batch queue, so clear is run right away.
        // Otherwise the hooks below won't work.
        self.flush_batch(source_range).await?;

        // Do the after clear scene hook.
        self.clear_scene_post_hook(source_range).await?;

        Ok(())
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
            responses: false,
        };

        let final_req = if self.batch().lock().unwrap().len() == 1 {
            // We can unwrap here because we know the batch has only one element.
            self.batch().lock().unwrap().first().unwrap().0.clone()
        } else {
            batched_requests
        };
        debug_batch(&final_req);

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
            WebSocketRequest::ModelingCmdBatchReq {
                requests: _,
                batch_id,
                responses: _,
            } => batch_id,
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

    async fn make_default_plane(
        &self,
        x_axis: Point3d,
        y_axis: Point3d,
        color: Option<Color>,
        source_range: crate::executor::SourceRange,
    ) -> Result<uuid::Uuid, KclError> {
        // Create new default planes.
        let default_size = 100.0;
        let default_origin = Point3d { x: 0.0, y: 0.0, z: 0.0 }.into();

        let plane_id = uuid::Uuid::new_v4();
        self.send_modeling_cmd(
            plane_id,
            source_range,
            ModelingCmd::MakePlane {
                clobber: false,
                origin: default_origin,
                size: default_size,
                x_axis: x_axis.into(),
                y_axis: y_axis.into(),
                hide: Some(true),
            },
        )
        .await?;

        if let Some(color) = color {
            // Set the color.
            self.send_modeling_cmd(
                uuid::Uuid::new_v4(),
                source_range,
                ModelingCmd::PlaneSetColor { color, plane_id },
            )
            .await?;
        }

        Ok(plane_id)
    }

    async fn new_default_planes(&self, source_range: crate::executor::SourceRange) -> Result<DefaultPlanes, KclError> {
        let plane_settings: HashMap<PlaneName, (Point3d, Point3d, Option<Color>)> = HashMap::from([
            (
                PlaneName::Xy,
                (
                    Point3d { x: 1.0, y: 0.0, z: 0.0 },
                    Point3d { x: 0.0, y: 1.0, z: 0.0 },
                    Some(Color {
                        r: 0.7,
                        g: 0.28,
                        b: 0.28,
                        a: 0.4,
                    }),
                ),
            ),
            (
                PlaneName::Yz,
                (
                    Point3d { x: 0.0, y: 1.0, z: 0.0 },
                    Point3d { x: 0.0, y: 0.0, z: 1.0 },
                    Some(Color {
                        r: 0.28,
                        g: 0.7,
                        b: 0.28,
                        a: 0.4,
                    }),
                ),
            ),
            (
                PlaneName::Xz,
                (
                    Point3d {
                        x: -1.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    Point3d { x: 0.0, y: 0.0, z: 1.0 },
                    Some(Color {
                        r: 0.28,
                        g: 0.28,
                        b: 0.7,
                        a: 0.4,
                    }),
                ),
            ),
            (
                PlaneName::NegXy,
                (
                    Point3d {
                        x: -1.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    Point3d { x: 0.0, y: 1.0, z: 0.0 },
                    None,
                ),
            ),
            (
                PlaneName::NegYz,
                (
                    Point3d {
                        x: 0.0,
                        y: -1.0,
                        z: 0.0,
                    },
                    Point3d { x: 0.0, y: 0.0, z: 1.0 },
                    None,
                ),
            ),
            (
                PlaneName::NegXz,
                (
                    Point3d {
                        x: 1.0, // TODO this should be -1.0
                        y: 0.0,
                        z: 0.0,
                    },
                    Point3d { x: 0.0, y: 0.0, z: 1.0 },
                    None,
                ),
            ),
        ]);

        let mut planes = HashMap::new();
        for (name, (x_axis, y_axis, color)) in plane_settings {
            planes.insert(
                name,
                self.make_default_plane(x_axis, y_axis, color, source_range).await?,
            );
        }

        // Flush the batch queue, so these planes are created right away.
        self.flush_batch(source_range).await?;

        Ok(DefaultPlanes {
            xy: planes[&PlaneName::Xy],
            neg_xy: planes[&PlaneName::NegXy],
            xz: planes[&PlaneName::Xz],
            neg_xz: planes[&PlaneName::NegXz],
            yz: planes[&PlaneName::Yz],
            neg_yz: planes[&PlaneName::NegYz],
        })
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
    | kittycad::types::ModelingCmd::ZoomToFit { .. }
    | kittycad::types::ModelingCmd::Solid3DGetExtrusionFaceInfo { .. }) = cmd
    else {
        return false;
    };

    true
}

#[derive(Debug, Hash, Eq, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PlaneName {
    /// The XY plane.
    Xy,
    /// The opposite side of the XY plane.
    NegXy,
    /// The XZ plane.
    Xz,
    /// The opposite side of the XZ plane.
    NegXz,
    /// The YZ plane.
    Yz,
    /// The opposite side of the YZ plane.
    NegYz,
}

#[allow(dead_code)] // Only used in debugging.
fn debug_batch(msg: &WebSocketRequest) {
    match msg {
        WebSocketRequest::ModelingCmdReq { cmd, cmd_id } => {
            println!("[ {cmd_id}: {:?} ]", cmd);
        }

        WebSocketRequest::ModelingCmdBatchReq { requests, .. } => {
            let names: Vec<_> = requests
                .iter()
                .map(|req| format!("{}: {:?}\n", req.cmd_id, req.cmd))
                .collect();
            println!("[ {} ]", names.join(", "))
        }
        other => panic!("this isn't a modeling command or batch: {other:?}"),
    }
}
