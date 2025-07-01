use kcmc::ModelingCmd;
use kittycad_modeling_cmds::{
    self as kcmc,
    websocket::{ModelingCmdReq, OkWebSocketResponseData},
};
use uuid::Uuid;

#[cfg(feature = "artifact-graph")]
use crate::exec::ArtifactCommand;
use crate::{
    ExecState, ExecutorContext, KclError, SourceRange,
    exec::{IdGenerator, KclValue},
    execution::Solid,
    std::Args,
};

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
    pub fn new(ctx: &'a ExecutorContext, source_range: SourceRange) -> Self {
        ModelingCmdMeta {
            ctx,
            source_range,
            id: None,
        }
    }

    pub fn with_id(ctx: &'a ExecutorContext, source_range: SourceRange, id: Uuid) -> Self {
        ModelingCmdMeta {
            ctx,
            source_range,
            id: Some(id),
        }
    }

    pub fn from_args_id(args: &'a Args, id: Uuid) -> Self {
        ModelingCmdMeta {
            ctx: &args.ctx,
            source_range: args.source_range,
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

impl<'a> From<&'a Args> for ModelingCmdMeta<'a> {
    fn from(args: &'a Args) -> Self {
        ModelingCmdMeta::new(&args.ctx, args.source_range)
    }
}

impl ExecState {
    /// Add a modeling command to the batch but don't fire it right away.
    pub(crate) async fn batch_modeling_cmd(
        &mut self,
        mut meta: ModelingCmdMeta<'_>,
        cmd: ModelingCmd,
    ) -> Result<(), crate::errors::KclError> {
        let id = meta.id(self.id_generator());
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
    ) -> Result<(), crate::errors::KclError> {
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
    ) -> Result<(), crate::errors::KclError> {
        let id = meta.id(self.id_generator());
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
        let id = meta.id(self.id_generator());
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
    ) -> Result<(), crate::errors::KclError> {
        let id = meta.id(self.id_generator());
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
        meta.ctx.engine.flush_batch(batch_end, meta.source_range).await
    }

    /// Flush just the fillets and chamfers for this specific SolidSet.
    pub(crate) async fn flush_batch_for_solids(
        &mut self,
        meta: ModelingCmdMeta<'_>,
        solids: &[Solid],
    ) -> Result<(), KclError> {
        // Make sure we don't traverse sketches more than once.
        let mut traversed_sketches = Vec::new();

        // Collect all the fillet/chamfer ids for the solids.
        let mut ids = Vec::new();
        for solid in solids {
            // We need to traverse the solids that share the same sketch.
            let sketch_id = solid.sketch.id;
            if !traversed_sketches.contains(&sketch_id) {
                // Find all the solids on the same shared sketch.
                ids.extend(
                    self.stack()
                        .walk_call_stack()
                        .filter(|v| matches!(v, KclValue::Solid { value } if value.sketch.id == sketch_id))
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
