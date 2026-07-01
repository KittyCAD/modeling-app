use ahash::AHashSet;
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
use crate::exec::ArtifactCommand;
use crate::exec::IdGenerator;
use crate::exec::KclValue;
use crate::execution::FaceParentSolid;
use crate::execution::Solid;
use crate::std::Args;

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
        self.push_command(ArtifactCommand {
            cmd_id: id,
            range: meta.source_range,
            command: cmd.clone(),
        });
        meta.ctx
            .engine
            .batch_modeling_cmd(&meta.ctx.engine_batch, id, meta.source_range, &cmd)
            .await
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
        for cmd_req in cmds {
            self.push_command(ArtifactCommand {
                cmd_id: *cmd_req.cmd_id.as_ref(),
                range: meta.source_range,
                command: cmd_req.cmd.clone(),
            });
        }
        meta.ctx
            .engine
            .batch_modeling_cmds(&meta.ctx.engine_batch, meta.source_range, cmds)
            .await
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
        // TODO: The order of the tracking of these doesn't match the order that
        // they're sent to the engine.
        self.push_command(ArtifactCommand {
            cmd_id: id,
            range: meta.source_range,
            command: cmd.clone(),
        });
        meta.ctx
            .engine
            .batch_end_cmd(&meta.ctx.engine_batch, id, meta.source_range, &cmd)
            .await
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
        self.push_command(ArtifactCommand {
            cmd_id: id,
            range: meta.source_range,
            command: cmd.clone(),
        });
        meta.ctx
            .engine
            .send_modeling_cmd(&meta.ctx.engine_batch, id, meta.source_range, &cmd)
            .await
    }

    /// Send a modeling cmd and wait for the response without recording it as an artifact command.
    ///
    /// This is for metadata lookups that support lint/refactor behavior but should not become
    /// part of the user's observable modeling command history.
    pub(crate) async fn send_modeling_cmd_for_metadata(
        &mut self,
        mut meta: ModelingCmdMeta<'_>,
        cmd: ModelingCmd,
    ) -> Result<OkWebSocketResponseData, KclError> {
        if self.is_in_sketch_block() {
            return Err(no_modeling_in_sketch_block_error(meta.source_range));
        }
        let id = meta.id(self.id_generator());
        meta.ctx
            .engine
            .send_modeling_cmd(&meta.ctx.engine_batch, id, meta.source_range, &cmd)
            .await
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
        meta.ctx
            .engine
            .flush_batch(&meta.ctx.engine_batch, batch_end, meta.source_range)
            .await
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
        let mut traversed_sketches = AHashSet::new();

        // Collect all the fillet/chamfer ids for the solids.
        let mut ids = Vec::new();
        for solid in solids {
            // We need to traverse the solids that share the same sketch.
            let sketch_id = solid.sketch_id().unwrap_or(solid.id);
            if !traversed_sketches.contains(&sketch_id) {
                // Find all the solids on the same shared sketch.
                ids.extend(
                    self.stack()
                        .walk_call_stack_with(|value| match value {
                            KclValue::Solid { value } if value.sketch_id().unwrap_or(value.id) == sketch_id => {
                                Some(value.get_all_edge_cut_ids().collect::<Vec<_>>())
                            }
                            _ => None,
                        })?
                        .into_iter()
                        .flatten(),
                );
                traversed_sketches.insert(sketch_id);
            }

            ids.extend(solid.get_all_edge_cut_ids());
        }

        self.flush_batch_for_edge_cut_ids(meta, ids).await
    }

    /// Flush just the fillets and chamfers for the parent solids of face-backed sketches.
    pub(crate) async fn flush_batch_for_face_parent_solids(
        &mut self,
        meta: ModelingCmdMeta<'_>,
        solids: &[FaceParentSolid],
    ) -> Result<(), KclError> {
        if self.is_in_sketch_block() {
            return Err(no_modeling_in_sketch_block_error(meta.source_range));
        }
        // Make sure we don't traverse sketches more than once.
        let mut traversed_sketches = AHashSet::new();

        // Collect all the fillet/chamfer ids for the solids.
        let mut ids = Vec::new();
        for solid in solids {
            // We need to traverse the solids that share the same sketch.
            let sketch_id = solid.sketch_or_solid_id();
            if !traversed_sketches.contains(&sketch_id) {
                // Find all the solids on the same shared sketch.
                ids.extend(
                    self.stack()
                        .walk_call_stack_with(|value| match value {
                            KclValue::Solid { value } if value.sketch_id().unwrap_or(value.id) == sketch_id => {
                                Some(value.get_all_edge_cut_ids().collect::<Vec<_>>())
                            }
                            _ => None,
                        })?
                        .into_iter()
                        .flatten(),
                );
                traversed_sketches.insert(sketch_id);
            }

            ids.extend(solid.edge_cut_ids.iter().copied());
        }

        self.flush_batch_for_edge_cut_ids(meta, ids).await
    }

    async fn flush_batch_for_edge_cut_ids(
        &mut self,
        meta: ModelingCmdMeta<'_>,
        ids: Vec<Uuid>,
    ) -> Result<(), KclError> {
        // We can return early if there are no fillets or chamfers.
        if ids.is_empty() {
            return Ok(());
        }

        // We want to move these fillets and chamfers from batch_end to batch so they get executed
        // before whatever we call next.
        meta.ctx.engine_batch.move_batch_end_to_batch(ids).await;

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
