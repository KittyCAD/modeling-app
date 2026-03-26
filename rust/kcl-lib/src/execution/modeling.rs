use kcmc::ModelingCmd;
use kittycad_modeling_cmds::websocket::ModelingCmdReq;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::{self as kcmc};
use uuid::Uuid;

use crate::ExecState;
use crate::ExecutorContext;
use crate::KclError;
use crate::SourceRange;
use crate::errors::KclErrorDetails;
#[cfg(feature = "artifact-graph")]
use crate::exec::ArtifactCommand;
use crate::exec::IdGenerator;
use crate::exec::KclValue;
use crate::execution::Solid;
use crate::std::Args;

#[cfg(target_arch = "wasm32")]
fn log_modeling_cmd(label: &str, id: Uuid, cmd: &ModelingCmd) {
    let serialized = serde_json::to_value(cmd).ok();
    let cmd_type = serialized
        .as_ref()
        .and_then(extract_variant_name_from_json)
        .unwrap_or_else(|| "unknown".to_owned());
    let payload = serialized
        .as_ref()
        .and_then(filter_interesting_json)
        .map(|value| serde_json::to_string(&value).unwrap_or_else(|_| "null".to_owned()))
        .unwrap_or_else(|| "null".to_owned());

    web_sys::console::log_1(
        &format!("[wasm modeling] label={label} cmd_id={id} type={cmd_type} payload={payload}").into(),
    );
}

#[cfg(target_arch = "wasm32")]
fn extract_variant_name_from_json(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Object(map) if map.get("type").is_some() => map.get("type")?.as_str().map(ToOwned::to_owned),
        serde_json::Value::Object(map) => map.keys().next().cloned(),
        _ => None,
    }
}

#[cfg(target_arch = "wasm32")]
fn filter_interesting_json(value: &serde_json::Value) -> Option<serde_json::Value> {
    match value {
        serde_json::Value::Object(map) => {
            let entries = map
                .iter()
                .filter_map(|(key, child)| {
                    if is_interesting_json_key(key) {
                        Some((key.clone(), child.clone()))
                    } else {
                        filter_interesting_json(child).map(|nested| (key.clone(), nested))
                    }
                })
                .collect::<serde_json::Map<String, serde_json::Value>>();

            if entries.is_empty() {
                None
            } else {
                Some(serde_json::Value::Object(entries))
            }
        }
        serde_json::Value::Array(items) => {
            let filtered = items
                .iter()
                .filter_map(filter_interesting_json)
                .collect::<Vec<serde_json::Value>>();

            if filtered.is_empty() {
                None
            } else {
                Some(serde_json::Value::Array(filtered))
            }
        }
        _ => None,
    }
}

#[cfg(target_arch = "wasm32")]
fn is_interesting_json_key(key: &str) -> bool {
    matches!(
        key,
        "id" | "ids"
            | "cmd_id"
            | "request_id"
            | "object_id"
            | "edge_id"
            | "face_id"
            | "face_ids"
            | "curve_id"
            | "entity_id"
            | "solid_id"
            | "sketch_id"
            | "target"
    ) || key.ends_with("_id")
        || key.ends_with("_ids")
}

/// Context and metadata needed to send a single modeling command.
///
/// Many functions consume Self so that the command ID isn't accidentally reused
/// among multiple modeling commands.
pub(crate) struct ModelingCmdMeta<'a> {
    /// The executor context, which contains the engine.
    pub ctx: &'a ExecutorContext,
    /// The source range of the command, used for error reporting.
    pub source_range: SourceRange,
    /// The id of the command, if it has been set by the caller or generated.
    id: Option<Uuid>,
}

impl<'a> ModelingCmdMeta<'a> {
    pub fn new(exec_state: &ExecState, ctx: &'a ExecutorContext, range: SourceRange) -> Self {
        ModelingCmdMeta {
            ctx,
            source_range: exec_state.mod_local.stdlib_entry_source_range.unwrap_or(range),
            id: None,
        }
    }

    pub fn with_id(exec_state: &ExecState, ctx: &'a ExecutorContext, range: SourceRange, id: Uuid) -> Self {
        ModelingCmdMeta {
            ctx,
            source_range: exec_state.mod_local.stdlib_entry_source_range.unwrap_or(range),
            id: Some(id),
        }
    }

    pub fn from_args(exec_state: &ExecState, args: &'a Args) -> Self {
        ModelingCmdMeta {
            ctx: &args.ctx,
            source_range: exec_state
                .mod_local
                .stdlib_entry_source_range
                .unwrap_or(args.source_range),
            id: None,
        }
    }

    pub fn from_args_id(exec_state: &ExecState, args: &'a Args, id: Uuid) -> Self {
        ModelingCmdMeta {
            ctx: &args.ctx,
            source_range: exec_state
                .mod_local
                .stdlib_entry_source_range
                .unwrap_or(args.source_range),
            id: Some(id),
        }
    }

    pub fn id(&mut self, id_generator: &mut IdGenerator) -> Uuid {
        if let Some(id) = self.id {
            return id;
        }
        let id = id_generator.next_uuid();
        self.id = Some(id);
        id
    }
}

impl ExecState {
    /// Add a modeling command to the batch but don't fire it right away.
    pub(crate) async fn batch_modeling_cmd(
        &mut self,
        mut meta: ModelingCmdMeta<'_>,
        cmd: ModelingCmd,
    ) -> Result<(), KclError> {
        if self.is_in_sketch_block() {
            return Err(no_modeling_in_sketch_block_error(meta.source_range));
        }
        let id = meta.id(self.id_generator());
        #[cfg(target_arch = "wasm32")]
        log_modeling_cmd("batch", id, &cmd);
        #[cfg(feature = "artifact-graph")]
        self.push_command(ArtifactCommand {
            cmd_id: id,
            range: meta.source_range,
            command: cmd.clone(),
        });
        meta.ctx.engine.batch_modeling_cmd(id, meta.source_range, &cmd).await
    }

    /// Add multiple modeling commands to the batch but don't fire them right
    /// away.
    pub(crate) async fn batch_modeling_cmds(
        &mut self,
        meta: ModelingCmdMeta<'_>,
        cmds: &[ModelingCmdReq],
    ) -> Result<(), KclError> {
        if self.is_in_sketch_block() {
            return Err(no_modeling_in_sketch_block_error(meta.source_range));
        }
        #[cfg(target_arch = "wasm32")]
        for cmd_req in cmds {
            log_modeling_cmd("batch_prebuilt", *cmd_req.cmd_id.as_ref(), &cmd_req.cmd);
        }
        #[cfg(feature = "artifact-graph")]
        for cmd_req in cmds {
            self.push_command(ArtifactCommand {
                cmd_id: *cmd_req.cmd_id.as_ref(),
                range: meta.source_range,
                command: cmd_req.cmd.clone(),
            });
        }
        meta.ctx.engine.batch_modeling_cmds(meta.source_range, cmds).await
    }

    /// Add a modeling command to the batch that gets executed at the end of the
    /// file. This is good for something like fillet or chamfer where the engine
    /// would eat the path id if we executed it right away.
    pub(crate) async fn batch_end_cmd(
        &mut self,
        mut meta: ModelingCmdMeta<'_>,
        cmd: ModelingCmd,
    ) -> Result<(), KclError> {
        if self.is_in_sketch_block() {
            return Err(no_modeling_in_sketch_block_error(meta.source_range));
        }
        let id = meta.id(self.id_generator());
        #[cfg(target_arch = "wasm32")]
        log_modeling_cmd("batch_end", id, &cmd);
        // TODO: The order of the tracking of these doesn't match the order that
        // they're sent to the engine.
        #[cfg(feature = "artifact-graph")]
        self.push_command(ArtifactCommand {
            cmd_id: id,
            range: meta.source_range,
            command: cmd.clone(),
        });
        meta.ctx.engine.batch_end_cmd(id, meta.source_range, &cmd).await
    }

    /// Send the modeling cmd and wait for the response.
    pub(crate) async fn send_modeling_cmd(
        &mut self,
        mut meta: ModelingCmdMeta<'_>,
        cmd: ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        if self.is_in_sketch_block() {
            return Err(no_modeling_in_sketch_block_error(meta.source_range));
        }
        let id = meta.id(self.id_generator());
        #[cfg(target_arch = "wasm32")]
        log_modeling_cmd("send", id, &cmd);
        #[cfg(feature = "artifact-graph")]
        self.push_command(ArtifactCommand {
            cmd_id: id,
            range: meta.source_range,
            command: cmd.clone(),
        });
        meta.ctx.engine.send_modeling_cmd(id, meta.source_range, &cmd).await
    }

    /// Send the modeling cmd async and don't wait for the response.
    /// Add it to our list of async commands.
    pub(crate) async fn async_modeling_cmd(
        &mut self,
        mut meta: ModelingCmdMeta<'_>,
        cmd: &ModelingCmd,
    ) -> Result<(), KclError> {
        if self.is_in_sketch_block() {
            return Err(no_modeling_in_sketch_block_error(meta.source_range));
        }
        let id = meta.id(self.id_generator());
        #[cfg(target_arch = "wasm32")]
        log_modeling_cmd("async_send", id, cmd);
        #[cfg(feature = "artifact-graph")]
        self.push_command(ArtifactCommand {
            cmd_id: id,
            range: meta.source_range,
            command: cmd.clone(),
        });
        meta.ctx.engine.async_modeling_cmd(id, meta.source_range, cmd).await
    }

    /// Force flush the batch queue.
    pub(crate) async fn flush_batch(
        &mut self,
        meta: ModelingCmdMeta<'_>,
        // Whether or not to flush the end commands as well.
        // We only do this at the very end of the file.
        batch_end: bool,
    ) -> Result<OkWebSocketResponseData, KclError> {
        if self.is_in_sketch_block() {
            return Err(no_modeling_in_sketch_block_error(meta.source_range));
        }
        meta.ctx.engine.flush_batch(batch_end, meta.source_range).await
    }

    /// Flush just the fillets and chamfers for this specific SolidSet.
    pub(crate) async fn flush_batch_for_solids(
        &mut self,
        meta: ModelingCmdMeta<'_>,
        solids: &[Solid],
    ) -> Result<(), KclError> {
        if self.is_in_sketch_block() {
            return Err(no_modeling_in_sketch_block_error(meta.source_range));
        }
        // Make sure we don't traverse sketches more than once.
        let mut traversed_sketches = Vec::new();

        // Collect all the fillet/chamfer ids for the solids.
        let mut ids = Vec::new();
        for solid in solids {
            // We need to traverse the solids that share the same sketch.
            let sketch_id = solid.sketch_id().unwrap_or(solid.id);
            if !traversed_sketches.contains(&sketch_id) {
                // Find all the solids on the same shared sketch.
                ids.extend(
                    self.stack()
                        .walk_call_stack()
                        .filter(|v| {
                            matches!(
                                v,
                                KclValue::Solid { value }
                                    if value.sketch_id().unwrap_or(value.id) == sketch_id
                            )
                        })
                        .flat_map(|v| match v {
                            KclValue::Solid { value } => value.get_all_edge_cut_ids(),
                            _ => unreachable!(),
                        }),
                );
                traversed_sketches.push(sketch_id);
            }

            ids.extend(solid.get_all_edge_cut_ids());
        }

        // We can return early if there are no fillets or chamfers.
        if ids.is_empty() {
            return Ok(());
        }

        // We want to move these fillets and chamfers from batch_end to batch so they get executed
        // before what ever we call next.
        for id in ids {
            // Pop it off the batch_end and add it to the batch.
            let Some(item) = meta.ctx.engine.batch_end().write().await.shift_remove(&id) else {
                // It might be in the batch already.
                continue;
            };
            // Add it to the batch.
            meta.ctx.engine.batch().write().await.push(item);
        }

        // Run flush.
        // Yes, we do need to actually flush the batch here, or references will fail later.
        self.flush_batch(meta, false).await?;

        Ok(())
    }
}

fn no_modeling_in_sketch_block_error(range: SourceRange) -> KclError {
    KclError::new_invalid_expression(KclErrorDetails::new(
        "Modeling commands communicating with the engine cannot be used inside a sketch block".to_owned(),
        vec![range],
    ))
}
