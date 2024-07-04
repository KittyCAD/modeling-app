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

use kittycad::types::{Color, ModelingCmd, ModelingCmdReq, OkWebSocketResponseData, WebSocketRequest};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{DefaultPlanes, Point3d},
};

lazy_static::lazy_static! {
    pub static ref GRID_OBJECT_ID: uuid::Uuid = uuid::Uuid::parse_str("cfa78409-653d-4c26-96f1-7c45fb784840").unwrap();

    pub static ref GRID_SCALE_TEXT_OBJECT_ID: uuid::Uuid = uuid::Uuid::parse_str("10782f33-f588-4668-8bcd-040502d26590").unwrap();
}

#[async_trait::async_trait]
pub trait EngineManager: std::fmt::Debug + Send + Sync + 'static {
    /// Get the batch of commands to be sent to the engine.
    fn batch(&self) -> Arc<Mutex<Vec<(kittycad::types::WebSocketRequest, crate::executor::SourceRange)>>>;

    /// Get the batch of end commands to be sent to the engine.
    fn batch_end(
        &self,
    ) -> Arc<Mutex<HashMap<uuid::Uuid, (kittycad::types::WebSocketRequest, crate::executor::SourceRange)>>>;

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
    ) -> Result<kittycad::types::WebSocketResponse, crate::errors::KclError>;

    async fn clear_scene(&self, source_range: crate::executor::SourceRange) -> Result<(), crate::errors::KclError> {
        self.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            source_range,
            &kittycad::types::ModelingCmd::SceneClearAll {},
        )
        .await?;

        // Flush the batch queue, so clear is run right away.
        // Otherwise the hooks below won't work.
        self.flush_batch(false, source_range).await?;

        // Do the after clear scene hook.
        self.clear_scene_post_hook(source_range).await?;

        Ok(())
    }

    // Add a modeling command to the batch but don't fire it right away.
    async fn batch_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: &kittycad::types::ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        let req = WebSocketRequest::ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id,
        };

        // Add cmd to the batch.
        self.batch().lock().unwrap().push((req, source_range));

        Ok(())
    }

    /// Add a command to the batch that needs to be executed at the very end.
    /// This for stuff like fillets or chamfers where if we execute too soon the
    /// engine will eat the ID and we can't reference it for other commands.
    async fn batch_end_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: &kittycad::types::ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        let req = WebSocketRequest::ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id,
        };

        // Add cmd to the batch end.
        self.batch_end().lock().unwrap().insert(id, (req, source_range));
        Ok(())
    }

    /// Send the modeling cmd and wait for the response.
    // TODO: This should only borrow `cmd`.
    // See https://github.com/KittyCAD/modeling-app/issues/2821
    async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: crate::executor::SourceRange,
        cmd: kittycad::types::ModelingCmd,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError> {
        self.batch_modeling_cmd(id, source_range, &cmd).await?;

        // Flush the batch queue.
        self.flush_batch(false, source_range).await
    }

    /// Force flush the batch queue.
    async fn flush_batch(
        &self,
        // Whether or not to flush the end commands as well.
        // We only do this at the very end of the file.
        batch_end: bool,
        source_range: crate::executor::SourceRange,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError> {
        let all_requests = if batch_end {
            let mut requests = self.batch().lock().unwrap().clone();
            requests.extend(self.batch_end().lock().unwrap().values().cloned());
            requests
        } else {
            self.batch().lock().unwrap().clone()
        };

        // Return early if we have no commands to send.
        if all_requests.is_empty() {
            return Ok(OkWebSocketResponseData::Modeling {
                modeling_response: kittycad::types::OkModelingCmdResponse::Empty {},
            });
        }

        let requests: Vec<ModelingCmdReq> = all_requests
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
            responses: true,
        };

        let final_req = if all_requests.len() == 1 {
            // We can unwrap here because we know the batch has only one element.
            all_requests.first().unwrap().0.clone()
        } else {
            batched_requests
        };

        // Create the map of original command IDs to source range.
        // This is for the wasm side, kurt needs it for selections.
        let mut id_to_source_range = std::collections::HashMap::new();
        for (req, range) in all_requests.iter() {
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
        if batch_end {
            self.batch_end().lock().unwrap().clear();
        }

        // We pop off the responses to cleanup our mappings.
        match final_req {
            WebSocketRequest::ModelingCmdBatchReq {
                ref requests,
                batch_id,
                responses: _,
            } => {
                // Get the last command ID.
                let last_id = requests.last().unwrap().cmd_id;
                let ws_resp = self
                    .inner_send_modeling_cmd(batch_id, source_range, final_req, id_to_source_range.clone())
                    .await?;
                let response = self.parse_websocket_response(ws_resp, source_range)?;

                // If we have a batch response, we want to return the specific id we care about.
                if let kittycad::types::OkWebSocketResponseData::ModelingBatch { responses } = &response {
                    self.parse_batch_responses(last_id, id_to_source_range, responses.clone())
                } else {
                    // We should never get here.
                    Err(KclError::Engine(KclErrorDetails {
                        message: format!("Failed to get batch response: {:?}", response),
                        source_ranges: vec![source_range],
                    }))
                }
            }
            WebSocketRequest::ModelingCmdReq { cmd: _, cmd_id } => {
                // You are probably wondering why we can't just return the source range we were
                // passed with the function. Well this is actually really important.
                // If this is the last command in the batch and there is only one and we've reached
                // the end of the file, this will trigger a flush batch function, but it will just
                // send default or the end of the file as it's source range not the origin of the
                // request so we need the original request source range in case the engine returns
                // an error.
                let source_range = id_to_source_range.get(&cmd_id).cloned().ok_or_else(|| {
                    KclError::Engine(KclErrorDetails {
                        message: format!("Failed to get source range for command ID: {:?}", cmd_id),
                        source_ranges: vec![],
                    })
                })?;
                let ws_resp = self
                    .inner_send_modeling_cmd(cmd_id, source_range, final_req, id_to_source_range)
                    .await?;
                self.parse_websocket_response(ws_resp, source_range)
            }
            _ => Err(KclError::Engine(KclErrorDetails {
                message: format!("The final request is not a modeling command: {:?}", final_req),
                source_ranges: vec![source_range],
            })),
        }
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
        self.batch_modeling_cmd(
            plane_id,
            source_range,
            &ModelingCmd::MakePlane {
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
            self.batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                source_range,
                &ModelingCmd::PlaneSetColor { color, plane_id },
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
                    Point3d { x: 1.0, y: 0.0, z: 0.0 },
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
                        x: -1.0,
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
        self.flush_batch(false, source_range).await?;

        Ok(DefaultPlanes {
            xy: planes[&PlaneName::Xy],
            neg_xy: planes[&PlaneName::NegXy],
            xz: planes[&PlaneName::Xz],
            neg_xz: planes[&PlaneName::NegXz],
            yz: planes[&PlaneName::Yz],
            neg_yz: planes[&PlaneName::NegYz],
        })
    }

    fn parse_websocket_response(
        &self,
        response: kittycad::types::WebSocketResponse,
        source_range: crate::executor::SourceRange,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError> {
        if let Some(data) = &response.resp {
            Ok(data.clone())
        } else if let Some(errors) = &response.errors {
            Err(KclError::Engine(KclErrorDetails {
                message: format!("Modeling command failed: {:?}", errors),
                source_ranges: vec![source_range],
            }))
        } else {
            // We should never get here.
            Err(KclError::Engine(KclErrorDetails {
                message: "Modeling command failed: no response or errors".to_string(),
                source_ranges: vec![source_range],
            }))
        }
    }

    fn parse_batch_responses(
        &self,
        // The last response we are looking for.
        id: uuid::Uuid,
        // The mapping of source ranges to command IDs.
        id_to_source_range: std::collections::HashMap<uuid::Uuid, crate::executor::SourceRange>,
        // The response from the engine.
        responses: HashMap<String, kittycad::types::BatchResponse>,
    ) -> Result<kittycad::types::OkWebSocketResponseData, crate::errors::KclError> {
        // Iterate over the responses and check for errors.
        for (cmd_id, resp) in responses.iter() {
            let cmd_id = uuid::Uuid::parse_str(cmd_id).map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: format!("Failed to parse command ID: {:?}", e),
                    source_ranges: vec![id_to_source_range[&id]],
                })
            })?;

            if let Some(errors) = resp.errors.as_ref() {
                // Get the source range for the command.
                let source_range = id_to_source_range.get(&cmd_id).cloned().ok_or_else(|| {
                    KclError::Engine(KclErrorDetails {
                        message: format!("Failed to get source range for command ID: {:?}", cmd_id),
                        source_ranges: vec![],
                    })
                })?;
                return Err(KclError::Engine(KclErrorDetails {
                    message: format!("Modeling command failed: {:?}", errors),
                    source_ranges: vec![source_range],
                }));
            }
            if let Some(response) = resp.response.as_ref() {
                if cmd_id == id {
                    // This is the response we care about.
                    return Ok(kittycad::types::OkWebSocketResponseData::Modeling {
                        modeling_response: response.clone(),
                    });
                } else {
                    // Continue the loop if this is not the response we care about.
                    continue;
                }
            }
        }

        // Return an error that we did not get an error or the response we wanted.
        // This should never happen but who knows.
        Err(KclError::Engine(KclErrorDetails {
            message: format!("Failed to find response for command ID: {:?}", id),
            source_ranges: vec![],
        }))
    }

    async fn modify_grid(&self, hidden: bool) -> Result<(), KclError> {
        // Hide/show the grid.
        self.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            Default::default(),
            &ModelingCmd::ObjectVisible {
                hidden,
                object_id: *GRID_OBJECT_ID,
            },
        )
        .await?;

        // Hide/show the grid scale text.
        self.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            Default::default(),
            &ModelingCmd::ObjectVisible {
                hidden,
                object_id: *GRID_SCALE_TEXT_OBJECT_ID,
            },
        )
        .await?;

        self.flush_batch(false, Default::default()).await?;

        Ok(())
    }
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
