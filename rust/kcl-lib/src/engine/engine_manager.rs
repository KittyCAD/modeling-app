use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::Ordering::Relaxed;

use anyhow::Result;
pub use engine_transport::EngineTransport;
use indexmap::IndexMap;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::shared::Color;
use kcmc::websocket::BatchResponse;
use kcmc::websocket::ModelingCmdReq;
use kcmc::websocket::ModelingSessionData;
use kcmc::websocket::OkWebSocketResponseData;
use kcmc::websocket::WebSocketRequest;
use kcmc::websocket::WebSocketResponse;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::websocket::ModelingBatch;
use kittycad_modeling_cmds::{self as kcmc};
use tokio::sync::RwLock;
use uuid::Uuid;
use web_time::Instant;

use crate::ExecutorSettings;
use crate::SourceRange;
use crate::engine::AsyncTasks;
use crate::engine::DEFAULT_PLANE_INFO;
use crate::engine::EngineBatchContext;
use crate::engine::EngineStats;
use crate::engine::GRID_OBJECT_ID;
use crate::engine::GRID_SCALE_TEXT_OBJECT_ID;
use crate::engine::GridScaleBehavior;
use crate::engine::PlaneName;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::DefaultPlanes;
use crate::execution::IdGenerator;
use crate::execution::PlaneInfo;
use crate::settings::types::default_backface_color;
use crate::settings::types::default_backface_color_struct;

pub enum TransportCloseError {}

mod engine_transport;
mod mock_transport;
#[cfg(target_arch = "wasm32")]
pub mod wasm_transport;
#[cfg(not(target_arch = "wasm32"))]
pub mod ws_transport;

/// Information about the responses from the engine.
#[derive(Clone, Debug)]
pub struct ResponseInformation {
    /// The responses from the engine.
    responses: Arc<RwLock<IndexMap<uuid::Uuid, WebSocketResponse>>>,
}

impl ResponseInformation {
    /// Basic constructor.
    pub fn new(responses: Arc<RwLock<IndexMap<uuid::Uuid, WebSocketResponse>>>) -> Self {
        Self { responses }
    }

    /// Add a new response from the engine.
    pub async fn add(&self, id: Uuid, response: WebSocketResponse) {
        self.responses.write().await.insert(id, response);
    }
}

#[derive(bon::Builder)]
pub struct EngineManager {
    // Replaces `engine_req_tx: mpsc::Sender<ToEngineReq>`
    // from the original native connection type.
    transport: Arc<Box<dyn EngineTransport>>,
    responses: ResponseInformation,
    pending_errors: Arc<RwLock<Vec<String>>>,
    socket_health: Arc<RwLock<SocketHealth>>,
    ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>>,

    /// The default planes for the scene.
    #[builder(default)]
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    /// If the server sends session data, it'll be copied to here.
    session_data: Arc<RwLock<Option<ModelingSessionData>>>,

    #[builder(default)]
    stats: EngineStats,

    #[builder(default)]
    async_tasks: AsyncTasks,
}

impl std::fmt::Debug for EngineManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EngineManager")
            .field("responses", &self.responses)
            .field("pending_errors", &self.pending_errors)
            .field("socket_health", &self.socket_health)
            .field("ids_of_async_commands", &self.ids_of_async_commands)
            .field("default_planes", &self.default_planes)
            .field("session_data", &self.session_data)
            .field("stats", &self.stats)
            .field("async_tasks", &self.async_tasks)
            .finish()
    }
}

impl EngineManager {
    #[cfg(target_arch = "wasm32")]
    pub fn new_wasm_transport(
        manager: wasm_transport::EngineCommandManager,
        response_context: Arc<wasm_transport::ResponseContext>,
    ) -> Self {
        let session_data: Arc<RwLock<Option<ModelingSessionData>>> = Arc::new(RwLock::new(None));
        let ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>> = Arc::new(RwLock::new(IndexMap::new()));
        let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
        let pending_errors = Arc::new(RwLock::new(Vec::new()));
        let responses = response_context.response_information();

        Self {
            transport: Arc::new(Box::new(wasm_transport::WasmTransport::new(manager))),
            responses,
            pending_errors,
            socket_health,
            ids_of_async_commands,
            default_planes: Default::default(),
            session_data,
            stats: Default::default(),
            async_tasks: Default::default(),
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new_websocket_transport(ws: reqwest::Upgraded, heartbeats: Option<u64>) -> Self {
        use crate::engine::engine_manager::ws_transport::WebSocketTransport;

        let session_data: Arc<RwLock<Option<ModelingSessionData>>> = Arc::new(RwLock::new(None));
        let ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>> = Arc::new(RwLock::new(IndexMap::new()));
        let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
        let pending_errors = Arc::new(RwLock::new(Vec::new()));
        let responses = ResponseInformation {
            responses: Arc::new(RwLock::new(IndexMap::new())),
        };

        let transport = WebSocketTransport::spawn(
            ws,
            heartbeats,
            responses.clone(),
            Arc::clone(&session_data),
            Arc::clone(&pending_errors),
            Arc::clone(&socket_health),
        )
        .await;

        Self {
            transport: Arc::new(Box::new(transport)),
            responses,
            pending_errors,
            socket_health,
            ids_of_async_commands,
            default_planes: Default::default(),
            session_data,
            stats: Default::default(),
            async_tasks: Default::default(),
        }
    }

    /// Mock connection that doesn't actually connect to anything.
    /// Used for testing.
    pub fn new_mock() -> Self {
        let session_data: Arc<RwLock<Option<ModelingSessionData>>> = Arc::new(RwLock::new(None));
        let ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>> = Arc::new(RwLock::new(IndexMap::new()));
        let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
        let pending_errors = Arc::new(RwLock::new(Vec::new()));
        let responses = ResponseInformation {
            responses: Arc::new(RwLock::new(IndexMap::new())),
        };
        Self {
            transport: Arc::new(Box::new(mock_transport::MockTransport::new(responses.clone()))),
            responses,
            pending_errors,
            socket_health,
            ids_of_async_commands,
            default_planes: Default::default(),
            session_data,
            stats: Default::default(),
            async_tasks: Default::default(),
        }
    }

    /// Take the ids of async commands that have accumulated so far and clear them.
    async fn take_ids_of_async_commands(&self) -> IndexMap<Uuid, SourceRange> {
        std::mem::take(&mut *self.ids_of_async_commands().write().await)
    }

    /// Take the responses that have accumulated so far and clear them.
    pub async fn take_responses(&self) -> IndexMap<Uuid, WebSocketResponse> {
        std::mem::take(&mut *self.responses().write().await)
    }

    pub async fn clear_scene(
        &self,
        batch_context: &EngineBatchContext,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<(), crate::errors::KclError> {
        // Clear any batched commands leftover from previous scenes.
        self.clear_queues(batch_context).await;

        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::SceneClearAll(mcmd::SceneClearAll::default()),
        )
        .await?;

        // Flush the batch queue, so clear is run right away.
        // Otherwise the hooks below won't work.
        self.flush_batch(batch_context, false, source_range).await?;

        // Do the after clear scene hook.
        self.clear_scene_post_hook(batch_context, id_generator, source_range)
            .await?;

        Ok(())
    }

    /// Ensure a specific async command has been completed.
    pub async fn ensure_async_command_completed(
        &self,
        id: uuid::Uuid,
        source_range: Option<SourceRange>,
    ) -> Result<OkWebSocketResponseData, KclError> {
        let source_range = if let Some(source_range) = source_range {
            source_range
        } else {
            // Look it up if we don't have it.
            self.ids_of_async_commands()
                .read()
                .await
                .get(&id)
                .cloned()
                .unwrap_or_default()
        };

        // The previous 60s ceiling here was too aggressive for long-running
        // engine commands - notably large STEP / B-rep imports, which the
        // engine itself routinely takes several minutes to process. When the
        // ceiling fired first the user got a generic "async command timed
        // out" message and the eventual engine response (success OR error)
        // was discarded, masking the real outcome. 600s (10 min) gives the
        // engine room to finish or to surface its own error.
        const ASYNC_CMD_TIMEOUT_SECS: u64 = 600;
        let current_time = Instant::now();
        while current_time.elapsed().as_secs() < ASYNC_CMD_TIMEOUT_SECS {
            let responses = self.responses().read().await.clone();
            let Some(resp) = responses.get(&id) else {
                // Yield to the event loop so that we don’t block the UI thread.
                // No seriously WE DO NOT WANT TO PAUSE THE WHOLE APP ON THE JS SIDE.
                #[cfg(target_arch = "wasm32")]
                {
                    let duration = web_time::Duration::from_millis(1);
                    wasm_timer::Delay::new(duration).await.map_err(|err| {
                        KclError::new_internal(KclErrorDetails::new(
                            format!("Failed to sleep: {:?}", err),
                            vec![source_range],
                        ))
                    })?;
                }
                #[cfg(not(target_arch = "wasm32"))]
                tokio::task::yield_now().await;
                continue;
            };

            // If the response is an error, return it.
            // Parsing will do that and we can ignore the result, we don't care.
            let response = self.parse_websocket_response(resp.clone(), source_range)?;
            return Ok(response);
        }

        Err(KclError::new_engine(KclErrorDetails::new(
            format!(
                "async command timed out after {ASYNC_CMD_TIMEOUT_SECS}s (client-side ceiling, not an engine error)"
            ),
            vec![source_range],
        )))
    }

    /// Ensure ALL async commands have been completed.
    pub async fn ensure_async_commands_completed(&self, batch_context: &EngineBatchContext) -> Result<(), KclError> {
        // Check if all async commands have been completed.
        let ids = self.take_ids_of_async_commands().await;

        // Try to get them from the responses.
        for (id, source_range) in ids {
            self.ensure_async_command_completed(id, Some(source_range)).await?;
        }

        // Make sure we check for all async tasks as well.
        // The reason why we ignore the error here is that, if a model fillets an edge
        // we previously called something on, it might no longer exist. In which case,
        // the artifact graph won't care either if its gone since you can't select it
        // anymore anyways.
        if let Err(err) = self.async_tasks().join_all().await {
            crate::log::logln!(
                "Error waiting for async tasks (this is typically fine and just means that an edge became something else): {:?}",
                err
            );
        }

        // Flush the batch to make sure nothing remains.
        self.flush_batch(batch_context, true, SourceRange::default()).await?;

        Ok(())
    }

    /// Set the visibility of edges.
    async fn set_edge_visibility(
        &self,
        batch_context: &EngineBatchContext,
        visible: bool,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
    ) -> Result<(), crate::errors::KclError> {
        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::from(mcmd::EdgeLinesVisible::builder().hidden(!visible).build()),
        )
        .await?;

        Ok(())
    }

    /// Re-run the command to apply the settings.
    pub async fn reapply_settings(
        &self,
        batch_context: &EngineBatchContext,
        settings: &crate::ExecutorSettings,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
        grid_scale_unit: GridScaleBehavior,
    ) -> Result<(), crate::errors::KclError> {
        // Set the edge visibility.
        self.set_edge_visibility(batch_context, settings.highlight_edges, source_range, id_generator)
            .await?;

        // Send the command to show the grid.

        self.modify_grid(
            batch_context,
            !settings.show_grid,
            grid_scale_unit,
            source_range,
            id_generator,
        )
        .await?;

        // Set up user's color choices.
        self.set_user_colors(batch_context, settings, source_range, id_generator)
            .await?;

        // We do not have commands for changing ssao on the fly.

        // Flush the batch queue, so the settings are applied right away.
        self.flush_batch(batch_context, false, source_range).await?;

        Ok(())
    }

    // Add a modeling command to the batch but don't fire it right away.
    pub async fn batch_modeling_cmd(
        &self,
        batch_context: &EngineBatchContext,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        let req = WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id.into(),
        });

        // Add cmd to the batch.
        batch_context.push(req, source_range).await;
        self.stats().commands_batched.fetch_add(1, Relaxed);

        Ok(())
    }

    // Add a vector of modeling commands to the batch but don't fire it right away.
    // This allows you to force them all to be added together in the same order.
    // When we are running things in parallel this prevents race conditions that might come
    // if specific commands are run before others.
    pub async fn batch_modeling_cmds(
        &self,
        batch_context: &EngineBatchContext,
        source_range: SourceRange,
        cmds: &[ModelingCmdReq],
    ) -> Result<(), crate::errors::KclError> {
        // Add cmds to the batch.
        let mut extended_cmds = Vec::with_capacity(cmds.len());
        for cmd in cmds {
            extended_cmds.push((WebSocketRequest::ModelingCmdReq(cmd.clone()), source_range));
        }
        self.stats().commands_batched.fetch_add(extended_cmds.len(), Relaxed);
        batch_context.extend(extended_cmds).await;

        Ok(())
    }

    /// Add a command to the batch that needs to be executed at the very end.
    /// This for stuff like fillets or chamfers where if we execute too soon the
    /// engine will eat the ID and we can't reference it for other commands.
    pub async fn batch_end_cmd(
        &self,
        batch_context: &EngineBatchContext,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        let req = WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
            cmd: cmd.clone(),
            cmd_id: id.into(),
        });

        // Add cmd to the batch end.
        batch_context.insert_end(id, req, source_range).await;
        self.stats().commands_batched.fetch_add(1, Relaxed);
        Ok(())
    }

    /// Send the modeling cmd and wait for the response.
    pub async fn send_modeling_cmd(
        &self,
        batch_context: &EngineBatchContext,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        let mut requests = batch_context.take_batch().await;

        // Add the command to the batch.
        requests.push((
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                cmd: cmd.clone(),
                cmd_id: id.into(),
            }),
            source_range,
        ));
        self.stats().commands_batched.fetch_add(1, Relaxed);

        // Flush the batch queue.
        self.run_batch(requests, source_range).await
    }

    /// Send the modeling cmd async and don't wait for the response.
    /// Add it to our list of async commands.
    pub async fn async_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: &ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        // Add the command ID to the list of async commands.
        self.ids_of_async_commands().write().await.insert(id, source_range);

        // Fire off the command now, but don't wait for the response, we don't care about it.
        self.transport
            .inner_fire_modeling_cmd(
                id,
                source_range,
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                    cmd: cmd.clone(),
                    cmd_id: id.into(),
                }),
                HashMap::from([(id, source_range)]),
            )
            .await?;

        Ok(())
    }

    /// Run the batch for the specific commands.
    async fn run_batch(
        &self,
        orig_requests: Vec<(WebSocketRequest, SourceRange)>,
        source_range: SourceRange,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        // Return early if we have no commands to send.
        if orig_requests.is_empty() {
            return Ok(OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::Empty {},
            });
        }

        let requests: Vec<ModelingCmdReq> = orig_requests
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

        let final_req = if orig_requests.len() == 1 {
            // We can unwrap here because we know the batch has only one element.
            orig_requests.first().unwrap().0.clone()
        } else {
            batched_requests
        };

        // Create the map of original command IDs to source range.
        // This is for the wasm side, kurt needs it for selections.
        let mut id_to_source_range = HashMap::new();
        for (req, range) in orig_requests.iter() {
            match req {
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq { cmd: _, cmd_id }) => {
                    id_to_source_range.insert(Uuid::from(*cmd_id), *range);
                }
                _ => {
                    return Err(KclError::new_engine(KclErrorDetails::new(
                        format!("The request is not a modeling command: {req:?}"),
                        vec![*range],
                    )));
                }
            }
        }

        self.stats().batches_sent.fetch_add(1, Relaxed);

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
                    Err(KclError::new_engine(KclErrorDetails::new(
                        format!("Failed to get batch response: {response:?}"),
                        vec![source_range],
                    )))
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
                    KclError::new_engine(KclErrorDetails::new(
                        format!("Failed to get source range for command ID: {cmd_id:?}"),
                        vec![],
                    ))
                })?;
                let ws_resp = self
                    .inner_send_modeling_cmd(cmd_id.into(), source_range, final_req, id_to_source_range)
                    .await?;
                self.parse_websocket_response(ws_resp, source_range)
            }
            _ => Err(KclError::new_engine(KclErrorDetails::new(
                format!("The final request is not a modeling command: {final_req:?}"),
                vec![source_range],
            ))),
        }
    }

    /// Force flush the batch queue.
    pub async fn flush_batch(
        &self,
        batch_context: &EngineBatchContext,
        // Whether or not to flush the end commands as well.
        // We only do this at the very end of the file.
        batch_end: bool,
        source_range: SourceRange,
    ) -> Result<OkWebSocketResponseData, crate::errors::KclError> {
        let all_requests = if batch_end {
            let mut requests = batch_context.take_batch().await;
            requests.extend(batch_context.take_batch_end().await.values().cloned());
            requests
        } else {
            batch_context.take_batch().await
        };

        self.run_batch(all_requests, source_range).await
    }

    async fn make_default_plane(
        &self,
        batch_context: &EngineBatchContext,
        plane_id: uuid::Uuid,
        info: &PlaneInfo,
        color: Option<Color>,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
    ) -> Result<uuid::Uuid, KclError> {
        // Create new default planes.
        let default_size = 100.0;

        self.batch_modeling_cmd(
            batch_context,
            plane_id,
            source_range,
            &ModelingCmd::from(
                mcmd::MakePlane::builder()
                    .clobber(false)
                    .origin(info.origin.into())
                    .size(LengthUnit(default_size))
                    .x_axis(info.x_axis.into())
                    .y_axis(info.y_axis.into())
                    .hide(true)
                    .build(),
            ),
        )
        .await?;

        if let Some(color) = color {
            // Set the color.
            self.batch_modeling_cmd(
                batch_context,
                id_generator.next_uuid(),
                source_range,
                &ModelingCmd::from(mcmd::PlaneSetColor::builder().color(color).plane_id(plane_id).build()),
            )
            .await?;
        }

        Ok(plane_id)
    }

    async fn new_default_planes(
        &self,
        batch_context: &EngineBatchContext,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<DefaultPlanes, KclError> {
        let plane_opacity = 0.1;
        let plane_settings: Vec<(PlaneName, Uuid, Option<Color>)> = vec![
            (
                PlaneName::Xy,
                id_generator.next_uuid(),
                Some(Color::from_rgba(0.7, 0.28, 0.28, plane_opacity)),
            ),
            (
                PlaneName::Yz,
                id_generator.next_uuid(),
                Some(Color::from_rgba(0.28, 0.7, 0.28, plane_opacity)),
            ),
            (
                PlaneName::Xz,
                id_generator.next_uuid(),
                Some(Color::from_rgba(0.28, 0.28, 0.7, plane_opacity)),
            ),
            (PlaneName::NegXy, id_generator.next_uuid(), None),
            (PlaneName::NegYz, id_generator.next_uuid(), None),
            (PlaneName::NegXz, id_generator.next_uuid(), None),
        ];

        let mut planes = HashMap::new();
        for (name, plane_id, color) in plane_settings {
            let info = DEFAULT_PLANE_INFO.get(&name).ok_or_else(|| {
                // We should never get here.
                KclError::new_engine(KclErrorDetails::new(
                    format!("Failed to get default plane info for: {name:?}"),
                    vec![source_range],
                ))
            })?;
            planes.insert(
                name,
                self.make_default_plane(batch_context, plane_id, info, color, source_range, id_generator)
                    .await?,
            );
        }

        // Flush the batch queue, so these planes are created right away.
        self.flush_batch(batch_context, false, source_range).await?;

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
                if fail.errors.is_empty() {
                    return Err(KclError::new_engine(KclErrorDetails::new(
                        "Failure response with no error details".to_owned(),
                        vec![source_range],
                    )));
                }
                Err(KclError::new_engine(KclErrorDetails::new(
                    fail.errors
                        .iter()
                        .map(|e| e.message.clone())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    vec![source_range],
                )))
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
                        KclError::new_engine(KclErrorDetails::new(
                            format!("Failed to get source range for command ID: {cmd_id:?}"),
                            vec![],
                        ))
                    })?;
                    if errors.is_empty() {
                        return Err(KclError::new_engine(KclErrorDetails::new(
                            "Failure response for batch with no error details".to_owned(),
                            vec![source_range],
                        )));
                    }
                    return Err(KclError::new_engine(KclErrorDetails::new(
                        errors.iter().map(|e| e.message.clone()).collect::<Vec<_>>().join("\n"),
                        vec![source_range],
                    )));
                }
            }
        }

        // Return an error that we did not get an error or the response we wanted.
        // This should never happen but who knows.
        Err(KclError::new_engine(KclErrorDetails::new(
            format!("Failed to find response for command ID: {id:?}"),
            vec![],
        )))
    }

    async fn set_user_colors(
        &self,
        batch_context: &EngineBatchContext,
        settings: &ExecutorSettings,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
    ) -> Result<(), KclError> {
        let bf = settings
            .default_backface_color
            .clone()
            .unwrap_or(default_backface_color());
        let backface = csscolorparser::parse(&bf)
            .map(|color| kcmc::shared::Color::from_rgba(color.r, color.g, color.b, color.a))
            .unwrap_or(default_backface_color_struct());
        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::from(
                mcmd::SetDefaultSystemProperties::builder()
                    .backface_color(backface)
                    .build(),
            ),
        )
        .await?;
        Ok(())
    }

    async fn modify_grid(
        &self,
        batch_context: &EngineBatchContext,
        hidden: bool,
        grid_scale_behavior: GridScaleBehavior,
        source_range: SourceRange,
        id_generator: &mut IdGenerator,
    ) -> Result<(), KclError> {
        // Hide/show the grid.
        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::from(
                mcmd::ObjectVisible::builder()
                    .hidden(hidden)
                    .object_id(*GRID_OBJECT_ID)
                    .build(),
            ),
        )
        .await?;

        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &grid_scale_behavior.into_modeling_cmd(),
        )
        .await?;

        // Hide/show the grid scale text.
        self.batch_modeling_cmd(
            batch_context,
            id_generator.next_uuid(),
            source_range,
            &ModelingCmd::from(
                mcmd::ObjectVisible::builder()
                    .hidden(hidden)
                    .object_id(*GRID_SCALE_TEXT_OBJECT_ID)
                    .build(),
            ),
        )
        .await?;

        Ok(())
    }

    pub async fn clear_queues(&self, batch_context: &EngineBatchContext) {
        batch_context.clear().await;
        self.ids_of_async_commands().write().await.clear();
        self.async_tasks().clear().await;
    }

    fn responses(&self) -> Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>> {
        self.responses.responses.clone()
    }

    fn ids_of_async_commands(&self) -> Arc<RwLock<IndexMap<Uuid, SourceRange>>> {
        self.ids_of_async_commands.clone()
    }

    fn async_tasks(&self) -> AsyncTasks {
        self.async_tasks.clone()
    }

    pub fn stats(&self) -> &EngineStats {
        &self.stats
    }

    pub fn get_default_planes(&self) -> Arc<RwLock<Option<DefaultPlanes>>> {
        self.default_planes.clone()
    }

    async fn clear_scene_post_hook(
        &self,
        batch_context: &EngineBatchContext,
        id_generator: &mut IdGenerator,
        source_range: SourceRange,
    ) -> Result<(), KclError> {
        // Remake the default planes, since they would have been removed after the scene was cleared.
        let new_planes = self
            .new_default_planes(batch_context, id_generator, source_range)
            .await?;
        *self.default_planes.write().await = Some(new_planes);

        self.transport.start_new_session(source_range).await?;

        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        let response = self
            .transport
            .inner_send_modeling_cmd(id, source_range, cmd, id_to_source_range)
            .await?;

        self.responses.add(id, response.clone()).await;
        Ok(response)
    }

    pub async fn get_session_data(&self) -> Option<ModelingSessionData> {
        self.session_data.read().await.clone()
    }

    pub async fn close(&self) {
        let _ = self.transport.close().await;
    }
}

/// State of the connection to the engine.
#[derive(Debug, PartialEq)]
pub enum SocketHealth {
    Active,
    Inactive,
}
