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
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

use indexmap::IndexMap;
use kcmc::{
    each_cmd as mcmd,
    id::ModelingCmdId,
    length_unit::LengthUnit,
    ok_response::OkModelingCmdResponse,
    shared::Color,
    websocket::{
        BatchResponse, ModelingBatch, ModelingCmdReq, ModelingSessionData, OkWebSocketResponseData, WebSocketRequest,
        WebSocketResponse,
    },
    ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ArtifactCommand, DefaultPlanes, IdGenerator, Point3d},
    SourceRange,
};

lazy_static::lazy_static! {
    pub static ref GRID_OBJECT_ID: uuid::Uuid = uuid::Uuid::parse_str("cfa78409-653d-4c26-96f1-7c45fb784840").unwrap();

    pub static ref GRID_SCALE_TEXT_OBJECT_ID: uuid::Uuid = uuid::Uuid::parse_str("10782f33-f588-4668-8bcd-040502d26590").unwrap();
}

/// The mode of execution.  When isolated, like during an import, attempting to
/// send a command results in an error.
#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionKind {
    #[default]
    Normal,
    Isolated,
}

impl ExecutionKind {
    pub fn is_isolated(&self) -> bool {
        matches!(self, ExecutionKind::Isolated)
    }
}

#[derive(Default, Debug)]
pub struct EngineStats {
    pub commands_batched: AtomicUsize,
    pub batches_sent: AtomicUsize,
}

impl Clone for EngineStats {
    fn clone(&self) -> Self {
        Self {
            commands_batched: AtomicUsize::new(self.commands_batched.load(Ordering::Relaxed)),
            batches_sent: AtomicUsize::new(self.batches_sent.load(Ordering::Relaxed)),
        }
    }
}

#[async_trait::async_trait]
pub trait EngineManager: std::fmt::Debug + Send + Sync + 'static {
    /// Get the batch of commands to be sent to the engine.
    fn batch(&self) -> Arc<RwLock<Vec<(WebSocketRequest, SourceRange)>>>;

    /// Get the batch of end commands to be sent to the engine.
    fn batch_end(&self) -> Arc<RwLock<IndexMap<uuid::Uuid, (WebSocketRequest, SourceRange)>>>;

    /// Get the command responses from the engine.
    fn responses(&self) -> Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>>;

    /// Get the artifact commands that have accumulated so far.
    fn artifact_commands(&self) -> Arc<RwLock<Vec<ArtifactCommand>>>;

    /// Clear all artifact commands that have accumulated so far.
    async fn clear_artifact_commands(&self) {
        self.artifact_commands().write().await.clear();
    }

    /// Take the artifact commands that have accumulated so far and clear them.
    async fn take_artifact_commands(&self) -> Vec<ArtifactCommand> {
        std::mem::take(&mut *self.artifact_commands().write().await)
    }

    /// Take the responses that have accumulated so far and clear them.
    async fn take_responses(&self) -> IndexMap<Uuid, WebSocketResponse> {
        std::mem::take(&mut *self.responses().write().await)
    }

    /// Get the current execution kind.
    async fn execution_kind(&self) -> ExecutionKind;

    /// Replace the current execution kind with a new value and return the
    /// existing value.
    async fn replace_execution_kind(&self, execution_kind: ExecutionKind) -> ExecutionKind;

    /// Get the default planes.
    fn get_default_planes(&self) -> Arc<RwLock<Option<DefaultPlanes>>>;

    fn stats(&self) -> &EngineStats;

    /// Get the default planes, creating them if they don't exist.
    async fn default_planes(
        &self,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<DefaultPlanes, KclError> {
        {
            let opt = self.get_default_planes().read().await.as_ref().cloned();
            if let Some(planes) = opt {
                return Ok(planes);
            }
        } // drop the read lock

        let new_planes = self.new_default_planes(id_generator, source_range).await?;
        *self.get_default_planes().write().await = Some(new_planes.clone());

        Ok(new_planes)
    }

    /// Helpers to be called after clearing a scene.
    /// (These really only apply to wasm for now).
    async fn clear_scene_post_hook(
        &self,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<(), crate::errors::KclError>;

    /// Send a modeling command and wait for the response message.
    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<uuid::Uuid, SourceRange>,
    ) -> Result<kcmc::websocket::WebSocketResponse, crate::errors::KclError>;

    async fn clear_scene(
        &self,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<(), crate::errors::KclError> {
        self.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            source_range,
            &ModelingCmd::SceneClearAll(mcmd::SceneClearAll::default()),
        )
        .await?;

        // Flush the batch queue, so clear is run right away.
        // Otherwise the hooks below won't work.
        self.flush_batch(false, source_range).await?;

        // Ensure artifact commands are cleared so that we don't accumulate them
        // across runs.
        self.clear_artifact_commands().await;

        // Do the after clear scene hook.
        self.clear_scene_post_hook(id_generator, source_range).await?;

        Ok(())
    }

    /// Set the visibility of edges.
    async fn set_edge_visibility(
        &self,
        visible: bool,
        source_range: SourceRange,
    ) -> Result<(), crate::errors::KclError> {
        self.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            source_range,
            &ModelingCmd::from(mcmd::EdgeLinesVisible { hidden: !visible }),
        )
        .await?;

        Ok(())
    }

    async fn handle_artifact_command(
        &self,
        cmd: &ModelingCmd,
        cmd_id: ModelingCmdId,
        id_to_source_range: &HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        let cmd_id = *cmd_id.as_ref();
        let range = id_to_source_range
            .get(&cmd_id)
            .copied()
            .ok_or_else(|| KclError::internal(format!("Failed to get source range for command ID: {:?}", cmd_id)))?;

        // Add artifact command.
        self.artifact_commands().write().await.push(ArtifactCommand {
            cmd_id,
            range,
            command: cmd.clone(),
        });
        Ok(())
    }

    async fn set_units(
        &self,
        units: crate::UnitLength,
        source_range: SourceRange,
    ) -> Result<(), crate::errors::KclError> {
        // Before we even start executing the program, set the units.
        self.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            source_range,
            &ModelingCmd::from(mcmd::SetSceneUnits { unit: units.into() }),
        )
        .await?;

        Ok(())
    }

    /// Re-run the command to apply the settings.
    async fn reapply_settings(
        &self,
        settings: &crate::ExecutorSettings,
        source_range: SourceRange,
    ) -> Result<(), crate::errors::KclError> {
        // Set the edge visibility.
        self.set_edge_visibility(settings.highlight_edges, source_range).await?;

        // Change the units.
        self.set_units(settings.units, source_range).await?;

        // Send the command to show the grid.
        self.modify_grid(!settings.show_grid, source_range).await?;

        // We do not have commands for changing ssao on the fly.

        // Flush the batch queue, so the settings are applied right away.
        self.flush_batch(false, source_range).await?;

        Ok(())
    }

    // Add a modeling command to the batch but don't fire it right away.
    async fn batch_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        // In isolated mode, we don't send the command to the engine.
        if self.execution_kind().await.is_isolated() {
            return Ok(());
        }

        let req = WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id.into(),
        });

        // Add cmd to the batch.
        self.batch().write().await.push((req, source_range));
        self.stats().commands_batched.fetch_add(1, Ordering::Relaxed);

        Ok(())
    }

    // Add a vector of modeling commands to the batch but don't fire it right away.
    // This allows you to force them all to be added together in the same order.
    // When we are running things in parallel this prevents race conditions that might come
    // if specific commands are run before others.
    async fn batch_modeling_cmds(
        &self,
        source_range: SourceRange,
        cmds: &[ModelingCmdReq],
    ) -> Result<(), crate::errors::KclError> {
        // In isolated mode, we don't send the command to the engine.
        if self.execution_kind().await.is_isolated() {
            return Ok(());
        }

        // Add cmds to the batch.
        let mut extended_cmds = Vec::with_capacity(cmds.len());
        for cmd in cmds {
            extended_cmds.push((WebSocketRequest::ModelingCmdReq(cmd.clone()), source_range));
        }
        self.stats()
            .commands_batched
            .fetch_add(extended_cmds.len(), Ordering::Relaxed);
        self.batch().write().await.extend(extended_cmds);

        Ok(())
    }

    /// Add a command to the batch that needs to be executed at the very end.
    /// This for stuff like fillets or chamfers where if we execute too soon the
    /// engine will eat the ID and we can't reference it for other commands.
    async fn batch_end_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        // In isolated mode, we don't send the command to the engine.
        if self.execution_kind().await.is_isolated() {
            return Ok(());
        }

        let req = WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id.into(),
        });

        // Add cmd to the batch end.
        self.batch_end().write().await.insert(id, (req, source_range));
        self.stats().commands_batched.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    /// Send the modeling cmd and wait for the response.
    async fn send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        self.batch_modeling_cmd(id, source_range, cmd).await?;

        // Flush the batch queue.
        self.flush_batch(false, source_range).await
    }

    /// Force flush the batch queue.
    async fn flush_batch(
        &self,
        // Whether or not to flush the end commands as well.
        // We only do this at the very end of the file.
        batch_end: bool,
        source_range: SourceRange,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        let all_requests = if batch_end {
            let mut requests = self.batch().read().await.clone();
            requests.extend(self.batch_end().read().await.values().cloned());
            requests
        } else {
            self.batch().read().await.clone()
        };

        // Return early if we have no commands to send.
        if all_requests.is_empty() {
            return Ok(OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::Empty {},
            });
        }

        let requests: Vec<ModelingCmdReq> = all_requests
            .iter()
            .filter_map(|(val, _)| match val {
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq { cmd, cmd_id }) => Some(ModelingCmdReq {
                    cmd: cmd.clone(),
                    cmd_id: *cmd_id,
                }),
                _ => None,
            })
            .collect();

        let batched_requests = WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
            requests,
            batch_id: uuid::Uuid::new_v4().into(),
            responses: true,
        });

        let final_req = if all_requests.len() == 1 {
            // We can unwrap here because we know the batch has only one element.
            all_requests.first().unwrap().0.clone()
        } else {
            batched_requests
        };

        // Create the map of original command IDs to source range.
        // This is for the wasm side, kurt needs it for selections.
        let mut id_to_source_range = HashMap::new();
        for (req, range) in all_requests.iter() {
            match req {
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq { cmd: _, cmd_id }) => {
                    id_to_source_range.insert(Uuid::from(*cmd_id), *range);
                }
                _ => {
                    return Err(KclError::Engine(KclErrorDetails {
                        message: format!("The request is not a modeling command: {:?}", req),
                        source_ranges: vec![*range],
                    }));
                }
            }
        }

        // Do the artifact commands.
        for (req, _) in all_requests.iter() {
            match &req {
                WebSocketRequest::ModelingCmdBatchReq(ModelingBatch { requests, .. }) => {
                    for request in requests {
                        self.handle_artifact_command(&request.cmd, request.cmd_id, &id_to_source_range)
                            .await?;
                    }
                }
                WebSocketRequest::ModelingCmdReq(request) => {
                    self.handle_artifact_command(&request.cmd, request.cmd_id, &id_to_source_range)
                        .await?;
                }
                _ => {}
            }
        }

        // Throw away the old batch queue.
        self.batch().write().await.clear();
        if batch_end {
            self.batch_end().write().await.clear();
        }
        self.stats().batches_sent.fetch_add(1, Ordering::Relaxed);

        // We pop off the responses to cleanup our mappings.
        match final_req {
            WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
                ref requests,
                batch_id,
                responses: _,
            }) => {
                // Get the last command ID.
                let last_id = requests.last().unwrap().cmd_id;
                let ws_resp = self
                    .inner_send_modeling_cmd(batch_id.into(), source_range, final_req, id_to_source_range.clone())
                    .await?;
                let response = self.parse_websocket_response(ws_resp, source_range)?;

                // If we have a batch response, we want to return the specific id we care about.
                if let OkWebSocketResponseData::ModelingBatch { responses } = response {
                    let responses = responses.into_iter().map(|(k, v)| (Uuid::from(k), v)).collect();
                    self.parse_batch_responses(last_id.into(), id_to_source_range, responses)
                } else {
                    // We should never get here.
                    Err(KclError::Engine(KclErrorDetails {
                        message: format!("Failed to get batch response: {:?}", response),
                        source_ranges: vec![source_range],
                    }))
                }
            }
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq { cmd: _, cmd_id }) => {
                // You are probably wondering why we can't just return the source range we were
                // passed with the function. Well this is actually really important.
                // If this is the last command in the batch and there is only one and we've reached
                // the end of the file, this will trigger a flush batch function, but it will just
                // send default or the end of the file as it's source range not the origin of the
                // request so we need the original request source range in case the engine returns
                // an error.
                let source_range = id_to_source_range.get(cmd_id.as_ref()).cloned().ok_or_else(|| {
                    KclError::Engine(KclErrorDetails {
                        message: format!("Failed to get source range for command ID: {:?}", cmd_id),
                        source_ranges: vec![],
                    })
                })?;
                let ws_resp = self
                    .inner_send_modeling_cmd(cmd_id.into(), source_range, final_req, id_to_source_range)
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
        plane_id: uuid::Uuid,
        x_axis: Point3d,
        y_axis: Point3d,
        color: Option<Color>,
        source_range: SourceRange,
    ) -> Result<uuid::Uuid, KclError> {
        // Create new default planes.
        let default_size = 100.0;
        let default_origin = Point3d { x: 0.0, y: 0.0, z: 0.0 }.into();

        self.batch_modeling_cmd(
            plane_id,
            source_range,
            &ModelingCmd::from(mcmd::MakePlane {
                clobber: false,
                origin: default_origin,
                size: LengthUnit(default_size),
                x_axis: x_axis.into(),
                y_axis: y_axis.into(),
                hide: Some(true),
            }),
        )
        .await?;

        if let Some(color) = color {
            // Set the color.
            self.batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                source_range,
                &ModelingCmd::from(mcmd::PlaneSetColor { color, plane_id }),
            )
            .await?;
        }

        Ok(plane_id)
    }

    async fn new_default_planes(
        &self,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<DefaultPlanes, KclError> {
        let plane_settings: Vec<(PlaneName, Uuid, Point3d, Point3d, Option<Color>)> = vec![
            (
                PlaneName::Xy,
                id_generator.next_uuid(),
                Point3d { x: 1.0, y: 0.0, z: 0.0 },
                Point3d { x: 0.0, y: 1.0, z: 0.0 },
                Some(Color {
                    r: 0.7,
                    g: 0.28,
                    b: 0.28,
                    a: 0.4,
                }),
            ),
            (
                PlaneName::Yz,
                id_generator.next_uuid(),
                Point3d { x: 0.0, y: 1.0, z: 0.0 },
                Point3d { x: 0.0, y: 0.0, z: 1.0 },
                Some(Color {
                    r: 0.28,
                    g: 0.7,
                    b: 0.28,
                    a: 0.4,
                }),
            ),
            (
                PlaneName::Xz,
                id_generator.next_uuid(),
                Point3d { x: 1.0, y: 0.0, z: 0.0 },
                Point3d { x: 0.0, y: 0.0, z: 1.0 },
                Some(Color {
                    r: 0.28,
                    g: 0.28,
                    b: 0.7,
                    a: 0.4,
                }),
            ),
            (
                PlaneName::NegXy,
                id_generator.next_uuid(),
                Point3d {
                    x: -1.0,
                    y: 0.0,
                    z: 0.0,
                },
                Point3d { x: 0.0, y: 1.0, z: 0.0 },
                None,
            ),
            (
                PlaneName::NegYz,
                id_generator.next_uuid(),
                Point3d {
                    x: 0.0,
                    y: -1.0,
                    z: 0.0,
                },
                Point3d { x: 0.0, y: 0.0, z: 1.0 },
                None,
            ),
            (
                PlaneName::NegXz,
                id_generator.next_uuid(),
                Point3d {
                    x: -1.0,
                    y: 0.0,
                    z: 0.0,
                },
                Point3d { x: 0.0, y: 0.0, z: 1.0 },
                None,
            ),
        ];

        let mut planes = HashMap::new();
        for (name, plane_id, x_axis, y_axis, color) in plane_settings {
            planes.insert(
                name,
                self.make_default_plane(plane_id, x_axis, y_axis, color, source_range)
                    .await?,
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
        response: WebSocketResponse,
        source_range: SourceRange,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        match response {
            WebSocketResponse::Success(success) => Ok(success.resp),
            WebSocketResponse::Failure(fail) => {
                let _request_id = fail.request_id;
                Err(KclError::Engine(KclErrorDetails {
                    message: format!("Modeling command failed: {:?}", fail.errors),
                    source_ranges: vec![source_range],
                }))
            }
        }
    }

    fn parse_batch_responses(
        &self,
        // The last response we are looking for.
        id: uuid::Uuid,
        // The mapping of source ranges to command IDs.
        id_to_source_range: HashMap<uuid::Uuid, SourceRange>,
        // The response from the engine.
        responses: HashMap<uuid::Uuid, BatchResponse>,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        // Iterate over the responses and check for errors.
        #[expect(
            clippy::iter_over_hash_type,
            reason = "modeling command uses a HashMap and keys are random, so we don't really have a choice"
        )]
        for (cmd_id, resp) in responses.iter() {
            match resp {
                BatchResponse::Success { response } => {
                    if cmd_id == &id {
                        // This is the response we care about.
                        return Ok(OkWebSocketResponseData::Modeling {
                            modeling_response: response.clone(),
                        });
                    } else {
                        // Continue the loop if this is not the response we care about.
                        continue;
                    }
                }
                BatchResponse::Failure { errors } => {
                    // Get the source range for the command.
                    let source_range = id_to_source_range.get(cmd_id).cloned().ok_or_else(|| {
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
            }
        }

        // Return an error that we did not get an error or the response we wanted.
        // This should never happen but who knows.
        Err(KclError::Engine(KclErrorDetails {
            message: format!("Failed to find response for command ID: {:?}", id),
            source_ranges: vec![],
        }))
    }

    async fn modify_grid(&self, hidden: bool, source_range: SourceRange) -> Result<(), KclError> {
        // Hide/show the grid.
        self.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            source_range,
            &ModelingCmd::from(mcmd::ObjectVisible {
                hidden,
                object_id: *GRID_OBJECT_ID,
            }),
        )
        .await?;

        // Hide/show the grid scale text.
        self.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            source_range,
            &ModelingCmd::from(mcmd::ObjectVisible {
                hidden,
                object_id: *GRID_SCALE_TEXT_OBJECT_ID,
            }),
        )
        .await?;

        Ok(())
    }

    /// Get session data, if it has been received.
    /// Returns None if the server never sent it.
    async fn get_session_data(&self) -> Option<ModelingSessionData> {
        None
    }

    /// Close the engine connection and wait for it to finish.
    async fn close(&self);
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

/// Create a new zoo api client.
#[cfg(not(target_arch = "wasm32"))]
pub fn new_zoo_client(token: Option<String>, engine_addr: Option<String>) -> anyhow::Result<kittycad::Client> {
    let user_agent = concat!(env!("CARGO_PKG_NAME"), ".rs/", env!("CARGO_PKG_VERSION"),);
    let http_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60));
    let ws_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60))
        .connection_verbose(true)
        .tcp_keepalive(std::time::Duration::from_secs(600))
        .http1_only();

    let zoo_token_env = std::env::var("ZOO_API_TOKEN");

    let token = if let Some(token) = token {
        token
    } else if let Ok(token) = std::env::var("KITTYCAD_API_TOKEN") {
        if let Ok(zoo_token) = zoo_token_env {
            if zoo_token != token {
                return Err(anyhow::anyhow!(
                    "Both environment variables KITTYCAD_API_TOKEN=`{}` and ZOO_API_TOKEN=`{}` are set. Use only one.",
                    token,
                    zoo_token
                ));
            }
        }
        token
    } else if let Ok(token) = zoo_token_env {
        token
    } else {
        return Err(anyhow::anyhow!(
            "No API token found in environment variables. Use KITTYCAD_API_TOKEN or ZOO_API_TOKEN"
        ));
    };

    // Create the client.
    let mut client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);
    // Set an engine address if it's set.
    let kittycad_host_env = std::env::var("KITTYCAD_HOST");
    if let Some(addr) = engine_addr {
        client.set_base_url(addr);
    } else if let Ok(addr) = std::env::var("ZOO_HOST") {
        if let Ok(kittycad_host) = kittycad_host_env {
            if kittycad_host != addr {
                return Err(anyhow::anyhow!(
                    "Both environment variables KITTYCAD_HOST=`{}` and ZOO_HOST=`{}` are set. Use only one.",
                    kittycad_host,
                    addr
                ));
            }
        }
        client.set_base_url(addr);
    } else if let Ok(addr) = kittycad_host_env {
        client.set_base_url(addr);
    }

    Ok(client)
}
