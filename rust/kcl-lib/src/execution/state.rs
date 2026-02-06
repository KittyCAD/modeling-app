#[cfg(feature = "artifact-graph")]
use std::collections::BTreeMap;
use std::{str::FromStr, sync::Arc};

use anyhow::Result;
use indexmap::IndexMap;
use kittycad_modeling_cmds::units::{UnitAngle, UnitLength};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    CompilationError, EngineManager, ExecutorContext, KclErrorWithOutputs, MockConfig, SourceRange,
    collections::AhashIndexSet,
    errors::{KclError, KclErrorDetails, Severity},
    exec::DefaultPlanes,
    execution::{
        EnvironmentRef, ExecOutcome, ExecutorSettings, KclValue, SketchVarId, UnsolvedSegment, annotations,
        cad_op::Operation,
        id_generator::IdGenerator,
        memory::{ProgramMemory, Stack},
        types::NumericType,
    },
    front::{Object, ObjectId},
    modules::{ModuleId, ModuleInfo, ModuleLoader, ModulePath, ModuleRepr, ModuleSource},
    parsing::ast::types::{Annotation, NodeRef},
};
#[cfg(feature = "artifact-graph")]
use crate::{
    execution::{Artifact, ArtifactCommand, ArtifactGraph, ArtifactId, ProgramLookup, sketch_solve::Solved},
    front::Number,
    id::IncIdGenerator,
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
    /// Global artifacts that represent the entire program.
    pub artifacts: ArtifactState,
    /// Artifacts for only the root module.
    pub root_module_artifacts: ModuleArtifactState,
    /// The segments that were edited that triggered this execution.
    #[cfg(feature = "artifact-graph")]
    pub segment_ids_edited: AhashIndexSet<ObjectId>,
}

#[cfg(feature = "artifact-graph")]
#[derive(Debug, Clone, Default)]
pub(super) struct ArtifactState {
    /// Internal map of UUIDs to exec artifacts.  This needs to persist across
    /// executions to allow the graph building to refer to cached artifacts.
    pub artifacts: IndexMap<ArtifactId, Artifact>,
    /// Output artifact graph.
    pub graph: ArtifactGraph,
}

#[cfg(not(feature = "artifact-graph"))]
#[derive(Debug, Clone, Default)]
pub(super) struct ArtifactState {}

/// Artifact state for a single module.
#[cfg(feature = "artifact-graph")]
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ModuleArtifactState {
    /// Internal map of UUIDs to exec artifacts.
    pub artifacts: IndexMap<ArtifactId, Artifact>,
    /// Outgoing engine commands that have not yet been processed and integrated
    /// into the artifact graph.
    #[serde(skip)]
    pub unprocessed_commands: Vec<ArtifactCommand>,
    /// Outgoing engine commands.
    pub commands: Vec<ArtifactCommand>,
    /// Operations that have been performed in execution order, for display in
    /// the Feature Tree.
    pub operations: Vec<Operation>,
    /// [`ObjectId`] generator.
    pub object_id_generator: IncIdGenerator<usize>,
    /// Objects in the scene, created from execution.
    pub scene_objects: Vec<Object>,
    /// Map from source range to object ID for lookup of objects by their source
    /// range.
    pub source_range_to_object: BTreeMap<SourceRange, ObjectId>,
    /// Map from artifact ID to object ID in the scene.
    pub artifact_id_to_scene_object: IndexMap<ArtifactId, ObjectId>,
    /// Solutions for sketch variables.
    pub var_solutions: Vec<(SourceRange, Number)>,
}

#[cfg(not(feature = "artifact-graph"))]
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ModuleArtifactState {}

#[derive(Debug, Clone)]
pub(super) struct ModuleState {
    /// The id generator for this module.
    pub id_generator: IdGenerator,
    pub stack: Stack,
    /// The size of the call stack. This is used to prevent stack overflows with
    /// recursive function calls. In general, this doesn't match `stack`'s size
    /// since it's conservative in reclaiming frames between executions.
    pub(super) call_stack_size: usize,
    /// The current value of the pipe operator returned from the previous
    /// expression.  If we're not currently in a pipeline, this will be None.
    pub pipe_value: Option<KclValue>,
    /// The closest variable declaration being executed in any parent node in the AST.
    /// This is used to provide better error messages, e.g. noticing when the user is trying
    /// to use the variable `length` inside the RHS of its own definition, like `length = tan(length)`.
    pub being_declared: Option<String>,
    /// Present if we're currently executing inside a sketch block.
    pub sketch_block: Option<SketchBlockState>,
    /// Tracks if KCL being executed is currently inside a stdlib function or not.
    /// This matters because e.g. we shouldn't emit artifacts from declarations declared inside a stdlib function.
    pub inside_stdlib: bool,
    /// The source range where we entered the standard library.
    pub stdlib_entry_source_range: Option<SourceRange>,
    /// Identifiers that have been exported from the current module.
    pub module_exports: Vec<String>,
    /// Settings specified from annotations.
    pub settings: MetaSettings,
    /// True if executing in sketch mode. Only a single sketch block will be
    /// executed. All other code is ignored.
    pub sketch_mode: bool,
    /// True to do more costly analysis of whether the sketch block segments are
    /// under-constrained. The only time we disable this is when a user is
    /// dragging segments.
    pub freedom_analysis: bool,
    pub(super) explicit_length_units: bool,
    pub(super) path: ModulePath,
    /// Artifacts for only this module.
    pub artifacts: ModuleArtifactState,

    pub(super) allowed_warnings: Vec<&'static str>,
    pub(super) denied_warnings: Vec<&'static str>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SketchBlockState {
    pub sketch_vars: Vec<KclValue>,
    #[cfg(feature = "artifact-graph")]
    pub sketch_constraints: Vec<ObjectId>,
    pub solver_constraints: Vec<kcl_ezpz::Constraint>,
    pub solver_optional_constraints: Vec<kcl_ezpz::Constraint>,
    pub needed_by_engine: Vec<UnsolvedSegment>,
}

impl ExecState {
    pub fn new(exec_context: &super::ExecutorContext) -> Self {
        ExecState {
            global: GlobalState::new(&exec_context.settings, Default::default()),
            mod_local: ModuleState::new(ModulePath::Main, ProgramMemory::new(), Default::default(), false, true),
        }
    }

    pub fn new_mock(exec_context: &super::ExecutorContext, mock_config: &MockConfig) -> Self {
        #[cfg(feature = "artifact-graph")]
        let segment_ids_edited = mock_config.segment_ids_edited.clone();
        #[cfg(not(feature = "artifact-graph"))]
        let segment_ids_edited = Default::default();
        ExecState {
            global: GlobalState::new(&exec_context.settings, segment_ids_edited),
            mod_local: ModuleState::new(
                ModulePath::Main,
                ProgramMemory::new(),
                Default::default(),
                mock_config.sketch_block_id.is_some(),
                mock_config.freedom_analysis,
            ),
        }
    }

    pub(super) fn reset(&mut self, exec_context: &super::ExecutorContext) {
        let global = GlobalState::new(&exec_context.settings, Default::default());

        *self = ExecState {
            global,
            mod_local: ModuleState::new(
                self.mod_local.path.clone(),
                ProgramMemory::new(),
                Default::default(),
                false,
                true,
            ),
        };
    }

    /// Log a non-fatal error.
    pub fn err(&mut self, e: CompilationError) {
        self.global.errors.push(e);
    }

    /// Log a warning.
    pub fn warn(&mut self, mut e: CompilationError, name: &'static str) {
        debug_assert!(annotations::WARN_VALUES.contains(&name));

        if self.mod_local.allowed_warnings.contains(&name) {
            return;
        }

        if self.mod_local.denied_warnings.contains(&name) {
            e.severity = Severity::Error;
        } else {
            e.severity = Severity::Warning;
        }

        self.global.errors.push(e);
    }

    pub fn warn_experimental(&mut self, feature_name: &str, source_range: SourceRange) {
        let Some(severity) = self.mod_local.settings.experimental_features.severity() else {
            return;
        };
        let error = CompilationError {
            source_range,
            message: format!("Use of {feature_name} is experimental and may change or be removed."),
            suggestion: None,
            severity,
            tag: crate::errors::Tag::None,
        };

        self.global.errors.push(error);
    }

    pub fn clear_units_warnings(&mut self, source_range: &SourceRange) {
        self.global.errors = std::mem::take(&mut self.global.errors)
            .into_iter()
            .filter(|e| {
                e.severity != Severity::Warning
                    || !source_range.contains_range(&e.source_range)
                    || e.tag != crate::errors::Tag::UnknownNumericUnits
            })
            .collect();
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
            operations: self.global.root_module_artifacts.operations,
            #[cfg(feature = "artifact-graph")]
            artifact_graph: self.global.artifacts.graph,
            #[cfg(feature = "artifact-graph")]
            scene_objects: self.global.root_module_artifacts.scene_objects,
            #[cfg(feature = "artifact-graph")]
            source_range_to_object: self.global.root_module_artifacts.source_range_to_object,
            #[cfg(feature = "artifact-graph")]
            var_solutions: self.global.root_module_artifacts.var_solutions,
            errors: self.global.errors,
            default_planes: ctx.engine.get_default_planes().read().await.clone(),
        }
    }

    pub(crate) fn stack(&self) -> &Stack {
        &self.mod_local.stack
    }

    pub(crate) fn mut_stack(&mut self) -> &mut Stack {
        &mut self.mod_local.stack
    }

    /// Increment the user-level call stack size, returning an error if it
    /// exceeds the maximum.
    pub(super) fn inc_call_stack_size(&mut self, range: SourceRange) -> Result<(), KclError> {
        // If you change this, make sure to test in WebAssembly in the app since
        // that's the limiting factor.
        if self.mod_local.call_stack_size >= 50 {
            return Err(KclError::MaxCallStack {
                details: KclErrorDetails::new("maximum call stack size exceeded".to_owned(), vec![range]),
            });
        }
        self.mod_local.call_stack_size += 1;
        Ok(())
    }

    /// Decrement the user-level call stack size, returning an error if it would
    /// go below zero.
    pub(super) fn dec_call_stack_size(&mut self, range: SourceRange) -> Result<(), KclError> {
        // Prevent underflow.
        if self.mod_local.call_stack_size == 0 {
            let message = "call stack size below zero".to_owned();
            debug_assert!(false, "{message}");
            return Err(KclError::new_internal(KclErrorDetails::new(message, vec![range])));
        }
        self.mod_local.call_stack_size -= 1;
        Ok(())
    }

    /// Returns true if we're executing in sketch mode for the current module.
    /// In sketch mode, we still want to execute the prelude and other stdlib
    /// modules as normal, so it can vary per module within a single overall
    /// execution.
    pub(crate) fn sketch_mode(&self) -> bool {
        self.mod_local.sketch_mode
            && match &self.mod_local.path {
                ModulePath::Main => true,
                ModulePath::Local { .. } => true,
                ModulePath::Std { .. } => false,
            }
    }

    #[cfg(not(feature = "artifact-graph"))]
    pub fn next_object_id(&mut self) -> ObjectId {
        // The return value should only ever be used when the feature is
        // enabled,
        ObjectId(0)
    }

    #[cfg(feature = "artifact-graph")]
    pub fn next_object_id(&mut self) -> ObjectId {
        ObjectId(self.mod_local.artifacts.object_id_generator.next_id())
    }

    #[cfg(not(feature = "artifact-graph"))]
    pub fn peek_object_id(&self) -> ObjectId {
        // The return value should only ever be used when the feature is
        // enabled,
        ObjectId(0)
    }

    #[cfg(feature = "artifact-graph")]
    pub fn peek_object_id(&self) -> ObjectId {
        ObjectId(self.mod_local.artifacts.object_id_generator.peek_id())
    }

    #[cfg(feature = "artifact-graph")]
    pub fn add_scene_object(&mut self, obj: Object, source_range: SourceRange) -> ObjectId {
        let id = obj.id;
        debug_assert!(
            id.0 == self.mod_local.artifacts.scene_objects.len(),
            "Adding scene object with ID {} but next ID is {}",
            id.0,
            self.mod_local.artifacts.scene_objects.len()
        );
        let artifact_id = obj.artifact_id;
        self.mod_local.artifacts.scene_objects.push(obj);
        self.mod_local.artifacts.source_range_to_object.insert(source_range, id);
        self.mod_local
            .artifacts
            .artifact_id_to_scene_object
            .insert(artifact_id, id);
        id
    }

    /// Add a placeholder scene object. This is useful when we need to reserve
    /// an ID before we have all the information to create the full object.
    #[cfg(feature = "artifact-graph")]
    pub fn add_placeholder_scene_object(&mut self, id: ObjectId, source_range: SourceRange) -> ObjectId {
        debug_assert!(id.0 == self.mod_local.artifacts.scene_objects.len());
        self.mod_local
            .artifacts
            .scene_objects
            .push(Object::placeholder(id, source_range));
        self.mod_local.artifacts.source_range_to_object.insert(source_range, id);
        id
    }

    /// Update a scene object. This is useful to replace a placeholder.
    #[cfg(feature = "artifact-graph")]
    pub fn set_scene_object(&mut self, object: Object) {
        let id = object.id;
        let artifact_id = object.artifact_id;
        self.mod_local.artifacts.scene_objects[id.0] = object;
        self.mod_local
            .artifacts
            .artifact_id_to_scene_object
            .insert(artifact_id, id);
    }

    #[cfg(feature = "artifact-graph")]
    pub fn scene_object_id_by_artifact_id(&self, artifact_id: ArtifactId) -> Option<ObjectId> {
        self.mod_local
            .artifacts
            .artifact_id_to_scene_object
            .get(&artifact_id)
            .cloned()
    }

    #[cfg(feature = "artifact-graph")]
    pub fn segment_ids_edited_contains(&self, object_id: &ObjectId) -> bool {
        self.global.segment_ids_edited.contains(object_id)
    }

    pub(super) fn is_in_sketch_block(&self) -> bool {
        self.mod_local.sketch_block.is_some()
    }

    pub(crate) fn sketch_block_mut(&mut self) -> Option<&mut SketchBlockState> {
        self.mod_local.sketch_block.as_mut()
    }

    pub fn next_uuid(&mut self) -> Uuid {
        self.mod_local.id_generator.next_uuid()
    }

    #[cfg(feature = "artifact-graph")]
    pub fn next_artifact_id(&mut self) -> ArtifactId {
        self.mod_local.id_generator.next_artifact_id()
    }

    pub fn id_generator(&mut self) -> &mut IdGenerator {
        &mut self.mod_local.id_generator
    }

    #[cfg(feature = "artifact-graph")]
    pub(crate) fn add_artifact(&mut self, artifact: Artifact) {
        let id = artifact.id();
        self.mod_local.artifacts.artifacts.insert(id, artifact);
    }

    pub(crate) fn push_op(&mut self, op: Operation) {
        #[cfg(feature = "artifact-graph")]
        self.mod_local.artifacts.operations.push(op);
        #[cfg(not(feature = "artifact-graph"))]
        drop(op);
    }

    #[cfg(feature = "artifact-graph")]
    pub(crate) fn push_command(&mut self, command: ArtifactCommand) {
        self.mod_local.artifacts.unprocessed_commands.push(command);
        #[cfg(not(feature = "artifact-graph"))]
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
        self.global.path_to_source_id.insert(path, id);
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
        self.global.id_to_source.insert(id, source);
    }

    pub(super) fn add_module(&mut self, id: ModuleId, path: ModulePath, repr: ModuleRepr) {
        debug_assert!(self.global.path_to_source_id.contains_key(&path));
        let module_info = ModuleInfo { id, repr, path };
        self.global.module_infos.insert(id, module_info);
    }

    pub fn get_module(&mut self, id: ModuleId) -> Option<&ModuleInfo> {
        self.global.module_infos.get(&id)
    }

    #[cfg(all(test, feature = "artifact-graph"))]
    pub(crate) fn modules(&self) -> &ModuleInfoMap {
        &self.global.module_infos
    }

    #[cfg(all(test, feature = "artifact-graph"))]
    pub(crate) fn root_module_artifact_state(&self) -> &ModuleArtifactState {
        &self.global.root_module_artifacts
    }

    pub fn current_default_units(&self) -> NumericType {
        NumericType::Default {
            len: self.length_unit(),
            angle: self.angle_unit(),
        }
    }

    pub fn length_unit(&self) -> UnitLength {
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
        main_ref: Option<EnvironmentRef>,
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
            main_ref
                .map(|main_ref| self.mod_local.variables(main_ref))
                .unwrap_or_default(),
            #[cfg(feature = "artifact-graph")]
            self.global.root_module_artifacts.operations.clone(),
            #[cfg(feature = "artifact-graph")]
            Default::default(),
            #[cfg(feature = "artifact-graph")]
            self.global.artifacts.graph.clone(),
            module_id_to_module_path,
            self.global.id_to_source.clone(),
            default_planes,
        )
    }

    #[cfg(feature = "artifact-graph")]
    pub(crate) fn build_program_lookup(
        &self,
        current: crate::parsing::ast::types::Node<crate::parsing::ast::types::Program>,
    ) -> ProgramLookup {
        ProgramLookup::new(current, self.global.module_infos.clone())
    }

    #[cfg(feature = "artifact-graph")]
    pub(crate) async fn build_artifact_graph(
        &mut self,
        engine: &Arc<Box<dyn EngineManager>>,
        program: NodeRef<'_, crate::parsing::ast::types::Program>,
    ) -> Result<(), KclError> {
        let mut new_commands = Vec::new();
        let mut new_exec_artifacts = IndexMap::new();
        for module in self.global.module_infos.values_mut() {
            match &mut module.repr {
                ModuleRepr::Kcl(_, Some(outcome)) => {
                    new_commands.extend(outcome.artifacts.process_commands());
                    new_exec_artifacts.extend(outcome.artifacts.artifacts.clone());
                }
                ModuleRepr::Foreign(_, Some((_, module_artifacts))) => {
                    new_commands.extend(module_artifacts.process_commands());
                    new_exec_artifacts.extend(module_artifacts.artifacts.clone());
                }
                ModuleRepr::Root | ModuleRepr::Kcl(_, None) | ModuleRepr::Foreign(_, None) | ModuleRepr::Dummy => {}
            }
        }
        // Take from the module artifacts so that we don't try to process them
        // again next time due to execution caching.
        new_commands.extend(self.global.root_module_artifacts.process_commands());
        // Note: These will get re-processed, but since we're just adding them
        // to a map, it's fine.
        new_exec_artifacts.extend(self.global.root_module_artifacts.artifacts.clone());
        let new_responses = engine.take_responses().await;

        // Move the artifacts into ExecState global to simplify cache
        // management.
        self.global.artifacts.artifacts.extend(new_exec_artifacts);

        let initial_graph = self.global.artifacts.graph.clone();

        // Build the artifact graph.
        let programs = self.build_program_lookup(program.clone());
        let graph_result = crate::execution::artifact::build_artifact_graph(
            &new_commands,
            &new_responses,
            program,
            &mut self.global.artifacts.artifacts,
            initial_graph,
            &programs,
            &self.global.module_infos,
        );

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
}

impl GlobalState {
    fn new(settings: &ExecutorSettings, segment_ids_edited: AhashIndexSet<ObjectId>) -> Self {
        #[cfg(not(feature = "artifact-graph"))]
        drop(segment_ids_edited);
        let mut global = GlobalState {
            path_to_source_id: Default::default(),
            module_infos: Default::default(),
            artifacts: Default::default(),
            root_module_artifacts: Default::default(),
            mod_loader: Default::default(),
            errors: Default::default(),
            id_to_source: Default::default(),
            #[cfg(feature = "artifact-graph")]
            segment_ids_edited,
        };

        let root_id = ModuleId::default();
        let root_path = settings.current_file.clone().unwrap_or_default();
        global.module_infos.insert(
            root_id,
            ModuleInfo {
                id: root_id,
                path: ModulePath::Local {
                    value: root_path.clone(),
                    original_import_path: None,
                },
                repr: ModuleRepr::Root,
            },
        );
        global.path_to_source_id.insert(
            ModulePath::Local {
                value: root_path,
                original_import_path: None,
            },
            root_id,
        );
        global
    }

    pub(super) fn filenames(&self) -> IndexMap<ModuleId, ModulePath> {
        self.path_to_source_id.iter().map(|(k, v)| ((*v), k.clone())).collect()
    }

    pub(super) fn get_source(&self, id: ModuleId) -> Option<&ModuleSource> {
        self.id_to_source.get(&id)
    }
}

impl ArtifactState {
    #[cfg(feature = "artifact-graph")]
    pub fn cached_body_items(&self) -> usize {
        self.graph.item_count
    }

    pub(crate) fn clear(&mut self) {
        #[cfg(feature = "artifact-graph")]
        {
            self.artifacts.clear();
            self.graph.clear();
        }
    }
}

impl ModuleArtifactState {
    pub(crate) fn clear(&mut self) {
        #[cfg(feature = "artifact-graph")]
        {
            self.artifacts.clear();
            self.unprocessed_commands.clear();
            self.commands.clear();
            self.operations.clear();
        }
    }

    #[cfg(not(feature = "artifact-graph"))]
    pub(crate) fn extend(&mut self, _other: ModuleArtifactState) {}

    /// When self is a cached state, extend it with new state.
    #[cfg(feature = "artifact-graph")]
    pub(crate) fn extend(&mut self, other: ModuleArtifactState) {
        self.artifacts.extend(other.artifacts);
        self.unprocessed_commands.extend(other.unprocessed_commands);
        self.commands.extend(other.commands);
        self.operations.extend(other.operations);
        if other.scene_objects.len() > self.scene_objects.len() {
            self.scene_objects
                .extend(other.scene_objects[self.scene_objects.len()..].iter().cloned());
        }
        self.source_range_to_object.extend(other.source_range_to_object);
        self.artifact_id_to_scene_object
            .extend(other.artifact_id_to_scene_object);
        self.var_solutions.extend(other.var_solutions);
    }

    // Move unprocessed artifact commands so that we don't try to process them
    // again next time due to execution caching.  Returns a clone of the
    // commands that were moved.
    #[cfg(feature = "artifact-graph")]
    pub(crate) fn process_commands(&mut self) -> Vec<ArtifactCommand> {
        let unprocessed = std::mem::take(&mut self.unprocessed_commands);
        let new_module_commands = unprocessed.clone();
        self.commands.extend(unprocessed);
        new_module_commands
    }

    #[cfg_attr(not(feature = "artifact-graph"), expect(dead_code))]
    pub(crate) fn scene_object_by_id(&self, id: ObjectId) -> Option<&Object> {
        #[cfg(feature = "artifact-graph")]
        {
            debug_assert!(
                id.0 < self.scene_objects.len(),
                "Requested object ID {} but only have {} objects",
                id.0,
                self.scene_objects.len()
            );
            self.scene_objects.get(id.0)
        }
        #[cfg(not(feature = "artifact-graph"))]
        {
            let _ = id;
            None
        }
    }

    #[cfg_attr(not(feature = "artifact-graph"), expect(dead_code))]
    pub(crate) fn scene_object_by_id_mut(&mut self, id: ObjectId) -> Option<&mut Object> {
        #[cfg(feature = "artifact-graph")]
        {
            debug_assert!(
                id.0 < self.scene_objects.len(),
                "Requested object ID {} but only have {} objects",
                id.0,
                self.scene_objects.len()
            );
            self.scene_objects.get_mut(id.0)
        }
        #[cfg(not(feature = "artifact-graph"))]
        {
            let _ = id;
            None
        }
    }
}

impl ModuleState {
    pub(super) fn new(
        path: ModulePath,
        memory: Arc<ProgramMemory>,
        module_id: Option<ModuleId>,
        sketch_mode: bool,
        freedom_analysis: bool,
    ) -> Self {
        ModuleState {
            id_generator: IdGenerator::new(module_id),
            stack: memory.new_stack(),
            call_stack_size: 0,
            pipe_value: Default::default(),
            being_declared: Default::default(),
            sketch_block: Default::default(),
            stdlib_entry_source_range: Default::default(),
            module_exports: Default::default(),
            explicit_length_units: false,
            path,
            settings: Default::default(),
            sketch_mode,
            freedom_analysis,
            artifacts: Default::default(),
            allowed_warnings: Vec::new(),
            denied_warnings: Vec::new(),
            inside_stdlib: false,
        }
    }

    pub(super) fn variables(&self, main_ref: EnvironmentRef) -> IndexMap<String, KclValue> {
        self.stack
            .find_all_in_env(main_ref)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}

impl SketchBlockState {
    pub(crate) fn next_sketch_var_id(&self) -> SketchVarId {
        SketchVarId(self.sketch_vars.len())
    }

    /// Given a solve outcome, return the solutions for the sketch variables and
    /// enough information to update them in the source.
    #[cfg(feature = "artifact-graph")]
    pub(crate) fn var_solutions(
        &self,
        solve_outcome: Solved,
        solution_ty: NumericType,
        range: SourceRange,
    ) -> Result<Vec<(SourceRange, Number)>, KclError> {
        self.sketch_vars
            .iter()
            .map(|v| {
                let Some(sketch_var) = v.as_sketch_var() else {
                    return Err(KclError::new_internal(KclErrorDetails::new(
                        "Expected sketch variable".to_owned(),
                        vec![range],
                    )));
                };
                let var_index = sketch_var.id.0;
                let solved_n = solve_outcome.final_values.get(var_index).ok_or_else(|| {
                    let message = format!("No solution for sketch variable with id {}", var_index);
                    debug_assert!(false, "{}", &message);
                    KclError::new_internal(KclErrorDetails::new(
                        message,
                        sketch_var.meta.iter().map(|m| m.source_range).collect(),
                    ))
                })?;
                let solved_value = Number {
                    value: *solved_n,
                    units: solution_ty.try_into().map_err(|_| {
                        KclError::new_internal(KclErrorDetails::new(
                            "Failed to convert numeric type to units".to_owned(),
                            vec![range],
                        ))
                    })?,
                };
                let Some(source_range) = sketch_var.meta.first().map(|m| m.source_range) else {
                    return Ok(None);
                };
                Ok(Some((source_range, solved_value)))
            })
            .filter_map(Result::transpose)
            .collect::<Result<Vec<_>, KclError>>()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MetaSettings {
    pub default_length_units: UnitLength,
    pub default_angle_units: UnitAngle,
    pub experimental_features: annotations::WarningLevel,
    pub kcl_version: String,
}

impl Default for MetaSettings {
    fn default() -> Self {
        MetaSettings {
            default_length_units: UnitLength::Millimeters,
            default_angle_units: UnitAngle::Degrees,
            experimental_features: annotations::WarningLevel::Deny,
            kcl_version: "1.0".to_owned(),
        }
    }
}

impl MetaSettings {
    pub(crate) fn update_from_annotation(
        &mut self,
        annotation: &crate::parsing::ast::types::Node<Annotation>,
    ) -> Result<(bool, bool), KclError> {
        let properties = annotations::expect_properties(annotations::SETTINGS, annotation)?;

        let mut updated_len = false;
        let mut updated_angle = false;
        for p in properties {
            match &*p.inner.key.name {
                annotations::SETTINGS_UNIT_LENGTH => {
                    let value = annotations::expect_ident(&p.inner.value)?;
                    let value = super::types::length_from_str(value, annotation.as_source_range())?;
                    self.default_length_units = value;
                    updated_len = true;
                }
                annotations::SETTINGS_UNIT_ANGLE => {
                    let value = annotations::expect_ident(&p.inner.value)?;
                    let value = super::types::angle_from_str(value, annotation.as_source_range())?;
                    self.default_angle_units = value;
                    updated_angle = true;
                }
                annotations::SETTINGS_VERSION => {
                    let value = annotations::expect_number(&p.inner.value)?;
                    self.kcl_version = value;
                }
                annotations::SETTINGS_EXPERIMENTAL_FEATURES => {
                    let value = annotations::expect_ident(&p.inner.value)?;
                    let value = annotations::WarningLevel::from_str(value).map_err(|_| {
                        KclError::new_semantic(KclErrorDetails::new(
                            format!(
                                "Invalid value for {} settings property, expected one of: {}",
                                annotations::SETTINGS_EXPERIMENTAL_FEATURES,
                                annotations::WARN_LEVELS.join(", ")
                            ),
                            annotation.as_source_ranges(),
                        ))
                    })?;
                    self.experimental_features = value;
                }
                name => {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "Unexpected settings key: `{name}`; expected one of `{}`, `{}`",
                            annotations::SETTINGS_UNIT_LENGTH,
                            annotations::SETTINGS_UNIT_ANGLE
                        ),
                        vec![annotation.as_source_range()],
                    )));
                }
            }
        }

        Ok((updated_len, updated_angle))
    }
}
