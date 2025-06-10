use std::sync::Arc;

use anyhow::Result;
use indexmap::IndexMap;
#[cfg(feature = "artifact-graph")]
use kcmc::websocket::WebSocketResponse;
use kcmc::{
    websocket::{ModelingCmdReq, OkWebSocketResponseData},
    ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(feature = "artifact-graph")]
use crate::execution::{Artifact, ArtifactCommand, ArtifactGraph, ArtifactId};
use crate::{
    errors::{KclError, KclErrorDetails, Severity},
    exec::DefaultPlanes,
    execution::{
        annotations,
        cad_op::Operation,
        id_generator::IdGenerator,
        memory::{ProgramMemory, Stack},
        types::{self, NumericType},
        EnvironmentRef, ExecOutcome, ExecutorSettings, KclValue, Solid, UnitAngle, UnitLen,
    },
    modules::{ModuleId, ModuleInfo, ModuleLoader, ModulePath, ModuleRepr, ModuleSource},
    parsing::ast::types::{Annotation, NodeRef},
    source_range::SourceRange,
    std::Args,
    CompilationError, EngineManager, ExecutorContext, KclErrorWithOutputs,
};

/// State for executing a program.
#[derive(Debug, Clone)]
pub struct ExecState {
    pub(super) global: GlobalState,
    pub(super) mod_local: ModuleState,
}

pub type ModuleInfoMap = IndexMap<ModuleId, ModuleInfo>;

#[derive(Debug, Clone)]
pub(super) struct GlobalState {
    /// Map from source file absolute path to module ID.
    pub path_to_source_id: IndexMap<ModulePath, ModuleId>,
    /// Map from module ID to source file.
    pub id_to_source: IndexMap<ModuleId, ModuleSource>,
    /// Map from module ID to module info.
    pub module_infos: ModuleInfoMap,
    /// Module loader.
    pub mod_loader: ModuleLoader,
    /// Errors and warnings.
    pub errors: Vec<CompilationError>,
    #[cfg_attr(not(feature = "artifact-graph"), allow(dead_code))]
    pub artifacts: ArtifactState,
    pub root_module_artifacts: ModuleArtifactState,
}

#[cfg(feature = "artifact-graph")]
#[derive(Debug, Clone, Default)]
pub(super) struct ArtifactState {
    /// Output map of UUIDs to artifacts.
    pub artifacts: IndexMap<ArtifactId, Artifact>,
    /// Output commands to allow building the artifact graph by the caller.
    /// These are accumulated in the [`ExecutorContext`] but moved here for
    /// convenience of the execution cache.
    pub commands: Vec<ArtifactCommand>,
    /// Responses from the engine for `artifact_commands`.  We need to cache
    /// this so that we can build the artifact graph.  These are accumulated in
    /// the [`ExecutorContext`] but moved here for convenience of the execution
    /// cache.
    pub responses: IndexMap<Uuid, WebSocketResponse>,
    /// Output artifact graph.
    pub graph: ArtifactGraph,
    /// Operations that have been performed in execution order, for display in
    /// the Feature Tree.
    pub operations: Vec<Operation>,
}

#[cfg(not(feature = "artifact-graph"))]
#[derive(Debug, Clone, Default)]
pub(super) struct ArtifactState {}

/// Artifact state for a single module.
#[cfg(all(test, feature = "artifact-graph"))]
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ModuleArtifactState {
    /// Output commands to allow building the artifact graph.
    pub commands: Vec<ArtifactCommand>,
    /// Operations that have been performed in execution order, for display in
    /// the Feature Tree.
    pub operations: Vec<Operation>,
}

#[cfg(not(all(test, feature = "artifact-graph")))]
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ModuleArtifactState {}

#[derive(Debug, Clone)]
pub(super) struct ModuleState {
    /// The id generator for this module.
    pub id_generator: IdGenerator,
    pub stack: Stack,
    /// The current value of the pipe operator returned from the previous
    /// expression.  If we're not currently in a pipeline, this will be None.
    pub pipe_value: Option<KclValue>,
    /// The closest variable declaration being executed in any parent node in the AST.
    /// This is used to provide better error messages, e.g. noticing when the user is trying
    /// to use the variable `length` inside the RHS of its own definition, like `length = tan(length)`.
    /// TODO: Make this a reference.
    pub being_declared: Option<String>,
    /// Identifiers that have been exported from the current module.
    pub module_exports: Vec<String>,
    /// Settings specified from annotations.
    pub settings: MetaSettings,
    pub(super) explicit_length_units: bool,
    pub(super) path: ModulePath,
    pub artifacts: ModuleArtifactState,
}

impl ExecState {
    pub fn new(exec_context: &super::ExecutorContext) -> Self {
        ExecState {
            global: GlobalState::new(&exec_context.settings),
            mod_local: ModuleState::new(ModulePath::Main, ProgramMemory::new(), Default::default()),
        }
    }

    pub(super) fn reset(&mut self, exec_context: &super::ExecutorContext) {
        let global = GlobalState::new(&exec_context.settings);

        *self = ExecState {
            global,
            mod_local: ModuleState::new(self.mod_local.path.clone(), ProgramMemory::new(), Default::default()),
        };
    }

    /// Log a non-fatal error.
    pub fn err(&mut self, e: CompilationError) {
        self.global.errors.push(e);
    }

    /// Log a warning.
    pub fn warn(&mut self, mut e: CompilationError) {
        e.severity = Severity::Warning;
        self.global.errors.push(e);
    }

    pub fn errors(&self) -> &[CompilationError] {
        &self.global.errors
    }

    /// Convert to execution outcome when running in WebAssembly.  We want to
    /// reduce the amount of data that crosses the WASM boundary as much as
    /// possible.
    pub async fn into_exec_outcome(self, main_ref: EnvironmentRef, ctx: &ExecutorContext) -> ExecOutcome {
        // Fields are opt-in so that we don't accidentally leak private internal
        // state when we add more to ExecState.
        ExecOutcome {
            variables: self.mod_local.variables(main_ref),
            filenames: self.global.filenames(),
            #[cfg(feature = "artifact-graph")]
            operations: self.global.artifacts.operations,
            #[cfg(feature = "artifact-graph")]
            artifact_graph: self.global.artifacts.graph,
            errors: self.global.errors,
            default_planes: ctx.engine.get_default_planes().read().await.clone(),
        }
    }

    pub async fn into_mock_exec_outcome(self, main_ref: EnvironmentRef, ctx: &ExecutorContext) -> ExecOutcome {
        ExecOutcome {
            variables: self.mod_local.variables(main_ref),
            #[cfg(feature = "artifact-graph")]
            operations: Default::default(),
            #[cfg(feature = "artifact-graph")]
            artifact_graph: Default::default(),
            errors: self.global.errors,
            filenames: Default::default(),
            default_planes: ctx.engine.get_default_planes().read().await.clone(),
        }
    }

    pub(crate) fn stack(&self) -> &Stack {
        &self.mod_local.stack
    }

    pub(crate) fn mut_stack(&mut self) -> &mut Stack {
        &mut self.mod_local.stack
    }

    pub fn next_uuid(&mut self) -> Uuid {
        self.mod_local.id_generator.next_uuid()
    }

    pub fn id_generator(&mut self) -> &mut IdGenerator {
        &mut self.mod_local.id_generator
    }

    #[cfg(feature = "artifact-graph")]
    pub(crate) fn add_artifact(&mut self, artifact: Artifact) {
        let id = artifact.id();
        self.global.artifacts.artifacts.insert(id, artifact);
    }

    pub(crate) fn push_op(&mut self, op: Operation) {
        #[cfg(all(test, feature = "artifact-graph"))]
        self.mod_local.artifacts.operations.push(op.clone());
        #[cfg(feature = "artifact-graph")]
        self.global.artifacts.operations.push(op);
        #[cfg(not(feature = "artifact-graph"))]
        drop(op);
    }

    #[cfg(feature = "artifact-graph")]
    pub(crate) fn push_command(&mut self, command: ArtifactCommand) {
        #[cfg(all(test, feature = "artifact-graph"))]
        self.mod_local.artifacts.commands.push(command);
        #[cfg(not(all(test, feature = "artifact-graph")))]
        drop(command);
    }

    pub(super) fn next_module_id(&self) -> ModuleId {
        ModuleId::from_usize(self.global.path_to_source_id.len())
    }

    pub(super) fn id_for_module(&self, path: &ModulePath) -> Option<ModuleId> {
        self.global.path_to_source_id.get(path).cloned()
    }

    pub(super) fn add_path_to_source_id(&mut self, path: ModulePath, id: ModuleId) {
        debug_assert!(!self.global.path_to_source_id.contains_key(&path));
        self.global.path_to_source_id.insert(path.clone(), id);
    }

    pub(crate) fn add_root_module_contents(&mut self, program: &crate::Program) {
        let root_id = ModuleId::default();
        // Get the path for the root module.
        let path = self
            .global
            .path_to_source_id
            .iter()
            .find(|(_, v)| **v == root_id)
            .unwrap()
            .0
            .clone();
        self.add_id_to_source(
            root_id,
            ModuleSource {
                path,
                source: program.original_file_contents.to_string(),
            },
        );
    }

    pub(super) fn add_id_to_source(&mut self, id: ModuleId, source: ModuleSource) {
        self.global.id_to_source.insert(id, source.clone());
    }

    pub(super) fn add_module(&mut self, id: ModuleId, path: ModulePath, repr: ModuleRepr) {
        debug_assert!(self.global.path_to_source_id.contains_key(&path));
        let module_info = ModuleInfo { id, repr, path };
        self.global.module_infos.insert(id, module_info);
    }

    pub fn get_module(&mut self, id: ModuleId) -> Option<&ModuleInfo> {
        self.global.module_infos.get(&id)
    }

    #[cfg(test)]
    pub(crate) fn modules(&self) -> &ModuleInfoMap {
        &self.global.module_infos
    }

    #[cfg(all(test, feature = "artifact-graph"))]
    pub(crate) fn operations(&self) -> &[Operation] {
        &self.global.artifacts.operations
    }

    #[cfg(test)]
    pub(crate) fn root_module_artifact_state(&self) -> &ModuleArtifactState {
        &self.global.root_module_artifacts
    }

    pub fn current_default_units(&self) -> NumericType {
        NumericType::Default {
            len: self.length_unit(),
            angle: self.angle_unit(),
        }
    }

    pub fn length_unit(&self) -> UnitLen {
        self.mod_local.settings.default_length_units
    }

    pub fn angle_unit(&self) -> UnitAngle {
        self.mod_local.settings.default_angle_units
    }

    pub(super) fn circular_import_error(&self, path: &ModulePath, source_range: SourceRange) -> KclError {
        KclError::new_import_cycle(KclErrorDetails::new(
            format!(
                "circular import of modules is not allowed: {} -> {}",
                self.global
                    .mod_loader
                    .import_stack
                    .iter()
                    .map(|p| p.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" -> "),
                path,
            ),
            vec![source_range],
        ))
    }

    pub(crate) fn pipe_value(&self) -> Option<&KclValue> {
        self.mod_local.pipe_value.as_ref()
    }

    pub(crate) fn error_with_outputs(
        &self,
        error: KclError,
        default_planes: Option<DefaultPlanes>,
    ) -> KclErrorWithOutputs {
        let module_id_to_module_path: IndexMap<ModuleId, ModulePath> = self
            .global
            .path_to_source_id
            .iter()
            .map(|(k, v)| ((*v), k.clone()))
            .collect();

        KclErrorWithOutputs::new(
            error,
            self.errors().to_vec(),
            #[cfg(feature = "artifact-graph")]
            self.global.artifacts.operations.clone(),
            #[cfg(feature = "artifact-graph")]
            self.global.artifacts.commands.clone(),
            #[cfg(feature = "artifact-graph")]
            self.global.artifacts.graph.clone(),
            module_id_to_module_path,
            self.global.id_to_source.clone(),
            default_planes,
        )
    }

    #[cfg(feature = "artifact-graph")]
    pub(crate) async fn build_artifact_graph(
        &mut self,
        engine: &Arc<Box<dyn EngineManager>>,
        program: NodeRef<'_, crate::parsing::ast::types::Program>,
    ) -> Result<(), KclError> {
        let new_commands = engine.take_artifact_commands().await;
        let new_responses = engine.take_responses().await;
        let initial_graph = self.global.artifacts.graph.clone();

        // Build the artifact graph.
        let graph_result = crate::execution::artifact::build_artifact_graph(
            &new_commands,
            &new_responses,
            program,
            &mut self.global.artifacts.artifacts,
            initial_graph,
        );
        // Move the artifact commands and responses into ExecState to
        // simplify cache management and error creation.
        self.global.artifacts.commands.extend(new_commands);
        self.global.artifacts.responses.extend(new_responses);

        let artifact_graph = graph_result?;
        self.global.artifacts.graph = artifact_graph;

        Ok(())
    }

    #[cfg(not(feature = "artifact-graph"))]
    pub(crate) async fn build_artifact_graph(
        &mut self,
        _engine: &Arc<Box<dyn EngineManager>>,
        _program: NodeRef<'_, crate::parsing::ast::types::Program>,
    ) -> Result<(), KclError> {
        Ok(())
    }

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

pub(crate) struct ModelingCmdMeta<'a> {
    pub ctx: &'a ExecutorContext,
    pub source_range: SourceRange,
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

impl GlobalState {
    fn new(settings: &ExecutorSettings) -> Self {
        let mut global = GlobalState {
            path_to_source_id: Default::default(),
            module_infos: Default::default(),
            artifacts: Default::default(),
            root_module_artifacts: Default::default(),
            mod_loader: Default::default(),
            errors: Default::default(),
            id_to_source: Default::default(),
        };

        let root_id = ModuleId::default();
        let root_path = settings.current_file.clone().unwrap_or_default();
        global.module_infos.insert(
            root_id,
            ModuleInfo {
                id: root_id,
                path: ModulePath::Local {
                    value: root_path.clone(),
                },
                repr: ModuleRepr::Root,
            },
        );
        global
            .path_to_source_id
            .insert(ModulePath::Local { value: root_path }, root_id);
        global
    }

    pub(super) fn filenames(&self) -> IndexMap<ModuleId, ModulePath> {
        self.path_to_source_id.iter().map(|(k, v)| ((*v), k.clone())).collect()
    }

    pub(super) fn get_source(&self, id: ModuleId) -> Option<&ModuleSource> {
        self.id_to_source.get(&id)
    }
}

#[cfg(feature = "artifact-graph")]
impl ArtifactState {
    pub fn cached_body_items(&self) -> usize {
        self.graph.item_count
    }
}

impl ModuleArtifactState {
    /// When self is a cached state, extend it with new state.
    #[cfg(all(test, feature = "artifact-graph"))]
    pub(crate) fn extend(&mut self, other: ModuleArtifactState) {
        self.commands.extend(other.commands);
        self.operations.extend(other.operations);
    }

    /// When self is a cached state, extend it with new state.
    #[cfg(not(all(test, feature = "artifact-graph")))]
    pub(crate) fn extend(&mut self, _other: ModuleArtifactState) {}
}

impl ModuleState {
    pub(super) fn new(path: ModulePath, memory: Arc<ProgramMemory>, module_id: Option<ModuleId>) -> Self {
        ModuleState {
            id_generator: IdGenerator::new(module_id),
            stack: memory.new_stack(),
            pipe_value: Default::default(),
            being_declared: Default::default(),
            module_exports: Default::default(),
            explicit_length_units: false,
            path,
            settings: MetaSettings {
                default_length_units: Default::default(),
                default_angle_units: Default::default(),
                kcl_version: "0.1".to_owned(),
            },
            artifacts: Default::default(),
        }
    }

    pub(super) fn variables(&self, main_ref: EnvironmentRef) -> IndexMap<String, KclValue> {
        self.stack
            .find_all_in_env(main_ref)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MetaSettings {
    pub default_length_units: types::UnitLen,
    pub default_angle_units: types::UnitAngle,
    pub kcl_version: String,
}

impl MetaSettings {
    pub(crate) fn update_from_annotation(
        &mut self,
        annotation: &crate::parsing::ast::types::Node<Annotation>,
    ) -> Result<bool, KclError> {
        let properties = annotations::expect_properties(annotations::SETTINGS, annotation)?;

        let mut updated_len = false;
        for p in properties {
            match &*p.inner.key.name {
                annotations::SETTINGS_UNIT_LENGTH => {
                    let value = annotations::expect_ident(&p.inner.value)?;
                    let value = types::UnitLen::from_str(value, annotation.as_source_range())?;
                    self.default_length_units = value;
                    updated_len = true;
                }
                annotations::SETTINGS_UNIT_ANGLE => {
                    let value = annotations::expect_ident(&p.inner.value)?;
                    let value = types::UnitAngle::from_str(value, annotation.as_source_range())?;
                    self.default_angle_units = value;
                }
                annotations::SETTINGS_VERSION => {
                    let value = annotations::expect_number(&p.inner.value)?;
                    self.kcl_version = value;
                }
                name => {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "Unexpected settings key: `{name}`; expected one of `{}`, `{}`",
                            annotations::SETTINGS_UNIT_LENGTH,
                            annotations::SETTINGS_UNIT_ANGLE
                        ),
                        vec![annotation.as_source_range()],
                    )))
                }
            }
        }

        Ok(updated_len)
    }
}
