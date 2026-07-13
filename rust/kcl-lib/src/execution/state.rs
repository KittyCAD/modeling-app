use std::collections::BTreeMap;
use std::str::FromStr;
use std::sync::Arc;

use ahash::AHashMap;
use anyhow::Result;
use indexmap::IndexMap;
use kcl_api::UnitAngle;
use kcl_api::UnitLength;
use serde::Deserialize;
use serde::Serialize;
use uuid::Uuid;

use crate::CompilationIssue;
use crate::ExecutorContext;
use crate::KclErrorWithOutputs;
use crate::MockConfig;
use crate::NodePath;
use crate::SegmentDragAnchor;
use crate::SourceRange;
use crate::collections::AhashIndexSet;
use crate::engine::engine_manager::EngineManager;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::errors::Severity;
use crate::exec::DefaultPlanes;
use crate::execution::Artifact;
use crate::execution::ArtifactCommand;
use crate::execution::ArtifactGraph;
use crate::execution::ArtifactId;
use crate::execution::EnvironmentRef;
use crate::execution::ExecOutcome;
use crate::execution::ExecutorSettings;
use crate::execution::KclValue;
use crate::execution::KclValueView;
use crate::execution::OperationCallbackArgs;
use crate::execution::OperationsByModule;
use crate::execution::ProgramLookup;
use crate::execution::SketchVarId;
use crate::execution::UnsolvedSegment;
use crate::execution::annotations;
use crate::execution::cad_op::Operation;
use crate::execution::id_generator::IdGenerator;
#[cfg(test)]
use crate::execution::memory::MemoryBackendKind;
use crate::execution::memory::ProgramMemory;
use crate::execution::memory::Stack;
use crate::execution::sketch_solve::Solved;
use crate::execution::types::NumericType;
use crate::front::Number;
use crate::front::Object;
use crate::front::ObjectId;
use crate::front::ObjectKind;
use crate::id::IncIdGenerator;
use crate::modules::ModuleId;
use crate::modules::ModuleInfo;
use crate::modules::ModuleLoader;
use crate::modules::ModulePath;
use crate::modules::ModuleRepr;
use crate::modules::ModuleSource;
use crate::parsing::ast::types::Annotation;
use crate::parsing::ast::types::NodeRef;
use crate::parsing::ast::types::TagNode;

/// State for executing a program.
#[derive(Debug, Clone)]
pub struct ExecState {
    pub(super) execution_callbacks: Option<std::sync::Arc<dyn crate::execution::ExecutionCallbacks>>,
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
    pub issues: Vec<CompilationIssue>,
    /// Global artifacts that represent the entire program.
    pub artifacts: ArtifactState,
    /// Artifacts for only the root module.
    pub root_module_artifacts: ModuleArtifactState,
    /// The segments that were edited that triggered this execution.
    pub segment_ids_edited: AhashIndexSet<ObjectId>,
    /// Segment-body drag anchors that temporarily pull a point on a segment toward the cursor.
    pub drag_anchors: Vec<SegmentDragAnchor>,
}

impl GlobalState {
    pub(crate) fn operations_by_module(&self) -> OperationsByModule {
        let mut operations = OperationsByModule::default();
        operations.insert(ModuleId::default(), self.root_module_artifacts.operations.clone());

        for (module_id, module_info) in &self.module_infos {
            match &module_info.repr {
                ModuleRepr::Root => {}
                ModuleRepr::Kcl(_, Some(outcome)) => {
                    operations.insert(*module_id, outcome.artifacts.operations.clone());
                }
                ModuleRepr::Foreign(_, Some((_, artifacts))) => {
                    operations.insert(*module_id, artifacts.operations.clone());
                }
                ModuleRepr::Kcl(_, None) | ModuleRepr::Foreign(_, None) | ModuleRepr::Dummy => {}
            }
        }

        operations
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ConstraintKey {
    LineCircle([usize; 10]),
    CircleCircle([usize; 12]),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TangencyMode {
    LineCircle(ezpz::LineSide),
    CircleCircle(ezpz::CircleSide),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConstraintState {
    Tangency(TangencyMode),
}

#[derive(Debug, Clone, Default)]
pub(super) struct ArtifactState {
    /// Internal map of UUIDs to exec artifacts.  This needs to persist across
    /// executions to allow the graph building to refer to cached artifacts.
    pub artifacts: IndexMap<ArtifactId, Artifact>,
    /// Output artifact graph.
    pub graph: ArtifactGraph,
}

/// Which stdlib edge function produced this refactor metadata (for lint/code mod).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum EdgeRefactorStdlibFn {
    GetOppositeEdge,
    GetNextAdjacentEdge,
    GetPreviousAdjacentEdge,
    GetCommonEdge,
    EdgeId,
}

/// Metadata collected when a deprecated edge stdlib function runs, for refactor-to-edgeRefs lint/code mod.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EdgeRefactorMeta {
    pub edge_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face_ids: Option<[Uuid; 2]>,
    pub source_range: SourceRange,
    pub stdlib_fn: EdgeRefactorStdlibFn,
}

/// One tag entry in a fillet/chamfer call that used `tags` directly (for refactor to edgeRefs).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectTagFilletTagEntry {
    pub tag_identifier: String,
    pub edge_id: Uuid,
    pub face_ids: [Uuid; 2],
}

/// Metadata for one fillet/chamfer call that used `tags` directly (no stdlib call).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectTagFilletMeta {
    pub call_source_range: SourceRange,
    pub tags: Vec<DirectTagFilletTagEntry>,
}

/// Unified metadata stream for Z0006 and future execution-backed refactors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum RefactorMetadata {
    EdgeRefactor(EdgeRefactorMeta),
    DirectTagFillet(DirectTagFilletMeta),
}

/// Artifact state for a single module.
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
    /// Incoming engine commands.
    #[cfg(feature = "snapshot-engine-responses")]
    pub responses: IndexMap<Uuid, kittycad_modeling_cmds::websocket::WebSocketResponse>,
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
    pub var_solutions: Vec<(SourceRange, Option<NodePath>, Number)>,
    /// Metadata collected during execution for refactor lint/code-mod paths (Z0006 and future).
    pub refactor_metadata: Vec<RefactorMetadata>,
}

#[derive(Debug, Clone)]
pub(super) struct ModuleState {
    /// The id of this module.
    pub module_id: ModuleId,
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
    /// Sticky per-constraint state persisted across sketch-mode mock solves.
    /// Maps from sketch block ID to a map for that sketch.
    /// Then the inner map is per constraint (in that sketch block) to its state.
    pub constraint_state: IndexMap<ObjectId, IndexMap<ConstraintKey, ConstraintState>>,

    pub(super) allowed_warnings: Vec<&'static str>,
    pub(super) denied_warnings: Vec<&'static str>,

    /// Map from consumed solid values to information about the operation that
    /// consumed them. Populated by operations that destroy their inputs so that
    /// subsequent attempts to use a consumed solid produce a clear KCL-level
    /// error rather than a cryptic engine error.
    pub(super) consumed_solids: AHashMap<ConsumedSolidKey, ConsumedSolidInfo>,
    /// Defensive map from consumed engine UUID to consumption info.
    /// Rust code may create a `Solid` with a consumed `engine_id` and a
    /// different `instance_id` that was not recorded in `consumed_solids`. When
    /// the exact key lookup misses, this map lets us reject that solid by
    /// `engine_id`, unless the key is a recorded operation output.
    pub(super) consumed_solid_ids: AHashMap<Uuid, ConsumedSolidInfo>,
}

/// Internal identity for one runtime KCL solid value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct ConsumedSolidKey {
    /// The engine body UUID.
    engine_id: Uuid,
    /// Distinguishes this KCL runtime instance from other values that may reuse
    /// the same engine body UUID.
    instance_id: Uuid,
}

impl ConsumedSolidKey {
    pub(crate) fn new(engine_id: Uuid, instance_id: Uuid) -> Self {
        Self { engine_id, instance_id }
    }

    pub(crate) fn engine_id(&self) -> Uuid {
        self.engine_id
    }

    pub(crate) fn instance_id(&self) -> Uuid {
        self.instance_id
    }
}

/// Information about a solid value that was consumed by an operation.
/// Stored in `ModuleState.consumed_solids` so subsequent attempts to use the
/// solid produce a clear error pointing at the operation that consumed it.
#[derive(Debug, Clone)]
pub(crate) struct ConsumedSolidInfo {
    /// The operation that consumed the solid.
    operation: ConsumedSolidOperation,
    /// First returned solid value, used only for replacement suggestions in
    /// error messages. When present, this key is also included in
    /// `returned_solid_keys`.
    suggested_replacement_key: Option<ConsumedSolidKey>,
    /// All solid values returned by that operation. This is used as the
    /// allow-list for returned solids that reuse a consumed engine UUID.
    returned_solid_keys: Vec<ConsumedSolidKey>,
}

impl ConsumedSolidInfo {
    pub(crate) fn new(operation: ConsumedSolidOperation, returned_solid_keys: Vec<ConsumedSolidKey>) -> Self {
        Self {
            operation,
            suggested_replacement_key: returned_solid_keys.first().copied(),
            returned_solid_keys,
        }
    }

    pub(crate) fn operation(&self) -> ConsumedSolidOperation {
        self.operation
    }

    pub(crate) fn suggested_replacement_key(&self) -> Option<ConsumedSolidKey> {
        self.suggested_replacement_key
    }

    pub(crate) fn should_report_reused_engine_id_as_consumed(&self, key: ConsumedSolidKey) -> bool {
        !self.returned_solid_keys.contains(&key)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConsumedSolidOperation {
    Union,
    Intersect,
    Subtract,
    Split,
    JoinSurfaces,
}

impl ConsumedSolidOperation {
    pub(crate) fn indefinite_article(self) -> &'static str {
        match self {
            Self::Intersect => "an",
            Self::Union | Self::Subtract | Self::Split | Self::JoinSurfaces => "a",
        }
    }
}

impl std::fmt::Display for ConsumedSolidOperation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Union => f.write_str("union"),
            Self::Intersect => f.write_str("intersect"),
            Self::Subtract => f.write_str("subtract"),
            Self::Split => f.write_str("split"),
            Self::JoinSurfaces => f.write_str("joinSurfaces"),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SketchBlockState {
    pub sketch_vars: Vec<KclValue>,
    pub sketch_id: Option<ObjectId>,
    pub sketch_constraints: Vec<ObjectId>,
    pub solver_constraints: Vec<ezpz::Constraint>,
    pub solver_optional_constraints: Vec<ezpz::Constraint>,
    pub needed_by_engine: Vec<UnsolvedSegment>,
    pub segment_tags: IndexMap<ObjectId, TagNode>,
}

impl ExecState {
    pub fn new(exec_context: &super::ExecutorContext) -> Self {
        ExecState {
            execution_callbacks: exec_context.execution_callbacks.clone(),
            global: GlobalState::new(&exec_context.settings, Default::default()),
            mod_local: ModuleState::new(ModulePath::Main, ProgramMemory::new(), Default::default(), false, true),
        }
    }

    #[cfg(test)]
    pub(crate) fn new_with_memory_backend(exec_context: &super::ExecutorContext, backend: MemoryBackendKind) -> Self {
        ExecState {
            execution_callbacks: exec_context.execution_callbacks.clone(),
            global: GlobalState::new(&exec_context.settings, Default::default()),
            mod_local: ModuleState::new(
                ModulePath::Main,
                ProgramMemory::new_with_backend(backend),
                Default::default(),
                false,
                true,
            ),
        }
    }

    pub fn new_mock(exec_context: &super::ExecutorContext, mock_config: &MockConfig) -> Self {
        let segment_ids_edited = mock_config.segment_ids_edited.clone();
        let mut global = GlobalState::new(&exec_context.settings, segment_ids_edited);
        global.drag_anchors = mock_config.drag_anchors.clone();
        ExecState {
            execution_callbacks: exec_context.execution_callbacks.clone(),
            global,
            mod_local: ModuleState::new(
                ModulePath::Main,
                ProgramMemory::new(),
                Default::default(),
                mock_config.sketch_block_id.is_some(),
                mock_config.freedom_analysis,
            ),
        }
    }

    #[cfg(test)]
    pub(crate) fn new_mock_with_memory_backend(
        exec_context: &super::ExecutorContext,
        mock_config: &MockConfig,
        backend: MemoryBackendKind,
    ) -> Self {
        let segment_ids_edited = mock_config.segment_ids_edited.clone();
        let mut global = GlobalState::new(&exec_context.settings, segment_ids_edited);
        global.drag_anchors = mock_config.drag_anchors.clone();
        ExecState {
            execution_callbacks: exec_context.execution_callbacks.clone(),
            global,
            mod_local: ModuleState::new(
                ModulePath::Main,
                ProgramMemory::new_with_backend(backend),
                Default::default(),
                mock_config.sketch_block_id.is_some(),
                mock_config.freedom_analysis,
            ),
        }
    }

    pub(super) fn reset(&mut self, exec_context: &super::ExecutorContext) {
        let global = GlobalState::new(&exec_context.settings, Default::default());

        *self = ExecState {
            execution_callbacks: exec_context.execution_callbacks.clone(),
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
    pub fn err(&mut self, e: CompilationIssue) {
        self.global.issues.push(e);
    }

    /// Log a warning.
    pub fn warn(&mut self, mut e: CompilationIssue, name: &'static str) {
        debug_assert!(annotations::WARN_VALUES.contains(&name));

        if self.mod_local.allowed_warnings.contains(&name) {
            return;
        }

        if self.mod_local.denied_warnings.contains(&name) {
            e.severity = Severity::Error;
        } else {
            e.severity = Severity::Warning;
        }

        self.global.issues.push(e);
    }

    pub fn warn_experimental(&mut self, feature_name: &str, source_range: SourceRange) {
        let Some(severity) = self.mod_local.settings.experimental_features.severity() else {
            return;
        };
        let error = CompilationIssue {
            source_range,
            message: format!("Use of {feature_name} is experimental and may change or be removed."),
            suggestion: None,
            severity,
            tag: crate::errors::Tag::None,
        };

        self.global.issues.push(error);
    }

    pub fn clear_units_warnings(&mut self, source_range: &SourceRange) {
        self.global.issues = std::mem::take(&mut self.global.issues)
            .into_iter()
            .filter(|e| {
                e.severity != Severity::Warning
                    || !source_range.contains_range(&e.source_range)
                    || e.tag != crate::errors::Tag::UnknownNumericUnits
            })
            .collect();
    }

    pub fn issues(&self) -> &[CompilationIssue] {
        &self.global.issues
    }

    /// Convert to execution outcome when running in WebAssembly.  We want to
    /// reduce the amount of data that crosses the WASM boundary as much as
    /// possible.
    pub async fn into_exec_outcome(
        self,
        main_ref: EnvironmentRef,
        ctx: &ExecutorContext,
    ) -> Result<ExecOutcome, KclError> {
        // Fields are opt-in so that we don't accidentally leak private internal
        // state when we add more to ExecState.
        let variables = self
            .mod_local
            .variables(main_ref)?
            .into_iter()
            .map(|(key, value)| (key, KclValueView::from(value)))
            .collect();
        Ok(ExecOutcome {
            variables,
            filenames: self.global.filenames(),
            operations: self.global.operations_by_module(),
            artifact_graph: self.global.artifacts.graph,
            scene_objects: self.global.root_module_artifacts.scene_objects,
            source_range_to_object: self.global.root_module_artifacts.source_range_to_object,
            var_solutions: self.global.root_module_artifacts.var_solutions,
            refactor_metadata: self.global.root_module_artifacts.refactor_metadata.clone(),
            issues: self.global.issues,
            default_planes: ctx.engine.get_default_planes().read().await.clone(),
        })
    }

    #[cfg(feature = "snapshot-engine-responses")]
    pub(crate) fn take_root_module_responses(
        &mut self,
    ) -> IndexMap<Uuid, kittycad_modeling_cmds::websocket::WebSocketResponse> {
        std::mem::take(&mut self.global.root_module_artifacts.responses)
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

    pub fn next_object_id(&mut self) -> ObjectId {
        ObjectId(self.mod_local.artifacts.object_id_generator.next_id())
    }

    pub fn peek_object_id(&self) -> ObjectId {
        ObjectId(self.mod_local.artifacts.object_id_generator.peek_id())
    }

    pub(crate) fn constraint_state(&self, sketch_block_id: ObjectId, key: &ConstraintKey) -> Option<ConstraintState> {
        let map = self.mod_local.constraint_state.get(&sketch_block_id)?;
        map.get(key).copied()
    }

    pub(crate) fn set_constraint_state(
        &mut self,
        sketch_block_id: ObjectId,
        key: ConstraintKey,
        state: ConstraintState,
    ) {
        let map = self.mod_local.constraint_state.entry(sketch_block_id).or_default();
        map.insert(key, state);
    }

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
    pub fn add_placeholder_scene_object(
        &mut self,
        id: ObjectId,
        source_range: SourceRange,
        node_path: Option<NodePath>,
    ) -> ObjectId {
        debug_assert!(id.0 == self.mod_local.artifacts.scene_objects.len());
        self.mod_local
            .artifacts
            .scene_objects
            .push(Object::placeholder(id, source_range, node_path));
        self.mod_local.artifacts.source_range_to_object.insert(source_range, id);
        id
    }

    /// Update a scene object. This is useful to replace a placeholder.
    pub fn set_scene_object(&mut self, object: Object) {
        let id = object.id;
        let artifact_id = object.artifact_id;
        self.mod_local.artifacts.scene_objects[id.0] = object;
        self.mod_local
            .artifacts
            .artifact_id_to_scene_object
            .insert(artifact_id, id);
    }

    pub fn scene_object_id_by_artifact_id(&self, artifact_id: ArtifactId) -> Option<ObjectId> {
        self.mod_local
            .artifacts
            .artifact_id_to_scene_object
            .get(&artifact_id)
            .cloned()
    }

    pub fn segment_ids_edited_contains(&self, object_id: &ObjectId) -> bool {
        self.global.segment_ids_edited.contains(object_id)
    }

    pub fn drag_anchor_target(&self, object_id: &ObjectId) -> Option<&crate::front::Point2d<crate::front::Number>> {
        self.global
            .drag_anchors
            .iter()
            .find(|anchor| &anchor.segment_id == object_id)
            .map(|anchor| &anchor.target)
    }

    pub(super) fn is_in_sketch_block(&self) -> bool {
        self.mod_local.sketch_block.is_some()
    }

    pub(crate) fn sketch_block_mut(&mut self) -> Option<&mut SketchBlockState> {
        self.mod_local.sketch_block.as_mut()
    }

    pub(crate) fn sketch_block(&mut self) -> Option<&SketchBlockState> {
        self.mod_local.sketch_block.as_ref()
    }

    pub fn next_uuid(&mut self) -> Uuid {
        self.mod_local.id_generator.next_uuid()
    }

    pub fn next_artifact_id(&mut self) -> ArtifactId {
        self.mod_local.id_generator.next_artifact_id()
    }

    pub fn id_generator(&mut self) -> &mut IdGenerator {
        &mut self.mod_local.id_generator
    }

    /// Record that a solid value has been consumed by a CSG boolean operation.
    pub(crate) fn mark_solid_consumed(&mut self, consumed_key: ConsumedSolidKey, info: ConsumedSolidInfo) {
        self.mod_local.consumed_solids.insert(consumed_key, info);
    }

    /// Record that an engine body UUID has been consumed by a CSG boolean
    /// operation.
    pub(crate) fn mark_solid_id_consumed(&mut self, consumed_id: Uuid, info: ConsumedSolidInfo) {
        self.mod_local.consumed_solid_ids.insert(consumed_id, info);
    }

    /// Look up whether a solid value was consumed by a previous CSG boolean
    /// operation.
    pub(crate) fn check_solid_consumed(&self, key: &ConsumedSolidKey) -> Option<&ConsumedSolidInfo> {
        self.mod_local.consumed_solids.get(key)
    }

    /// Look up whether an engine body UUID was consumed by a previous CSG
    /// boolean operation.
    pub(crate) fn check_solid_id_consumed(&self, id: &Uuid) -> Option<&ConsumedSolidInfo> {
        self.mod_local.consumed_solid_ids.get(id)
    }

    /// Follow direct replacement links until we find the latest known output.
    /// Used only on error paths so diagnostics can suggest the current solid.
    pub(crate) fn latest_consumed_output(
        &self,
        suggested_replacement_key: Option<ConsumedSolidKey>,
    ) -> Option<ConsumedSolidKey> {
        let mut latest = suggested_replacement_key?;
        let mut seen = AhashIndexSet::default();

        while seen.insert(latest) {
            let Some(next) = self
                .mod_local
                .consumed_solids
                .get(&latest)
                .and_then(|info| info.suggested_replacement_key())
            else {
                break;
            };
            latest = next;
        }

        Some(latest)
    }

    /// Search the live environment for the name of a variable holding a Solid
    /// (or an array of Solids) whose value identity matches `target_key`. Used only on
    /// error paths to recover variable names for diagnostics.
    pub(crate) fn find_var_name_for_solid_key(&self, target_key: ConsumedSolidKey) -> Result<Option<String>, KclError> {
        fn contains_solid_key(value: &KclValue, target_key: ConsumedSolidKey) -> bool {
            match value {
                KclValue::Solid { value } => {
                    value.id == target_key.engine_id() && value.value_id == target_key.instance_id()
                }
                KclValue::HomArray { value, .. } => value.iter().any(|v| contains_solid_key(v, target_key)),
                _ => false,
            }
        }
        self.mod_local
            .stack
            .find_var_name_in_all_envs(|value| contains_solid_key(value, target_key))
    }

    pub(crate) fn add_artifact(&mut self, artifact: Artifact) {
        let id = artifact.id();
        self.mod_local.artifacts.artifacts.insert(id, artifact);
    }

    pub(crate) fn artifact_mut(&mut self, id: ArtifactId) -> Option<&mut Artifact> {
        self.mod_local.artifacts.artifacts.get_mut(&id)
    }

    pub(crate) fn push_op(&mut self, op: Operation) {
        let index = self.mod_local.artifacts.operations.len();
        self.mod_local.artifacts.operations.push(op);
        if let Some(operation) = self.mod_local.artifacts.operations.last().cloned()
            && let Some(callbacks) = &self.execution_callbacks
        {
            callbacks.on_operation(OperationCallbackArgs {
                module_id: self.mod_local.module_id,
                operation,
                index,
            });
        }
    }

    pub(crate) fn push_command(&mut self, command: ArtifactCommand) {
        self.mod_local.artifacts.unprocessed_commands.push(command);
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

    #[cfg(test)]
    pub(crate) fn modules(&self) -> &ModuleInfoMap {
        &self.global.module_infos
    }

    #[cfg(test)]
    pub(crate) fn root_module_artifact_state(&self) -> &ModuleArtifactState {
        &self.global.root_module_artifacts
    }

    /// Record metadata from a deprecated edge stdlib call for the Z0006 refactor.
    ///
    /// This is intentionally collected unconditionally when artifact graph support is enabled.
    /// The temporary feature flag only controls whether the lint/action is shown in the app.
    pub(crate) fn record_edge_refactor_meta(&mut self, meta: EdgeRefactorMeta) {
        self.mod_local
            .artifacts
            .refactor_metadata
            .push(RefactorMetadata::EdgeRefactor(meta));
    }

    pub(crate) fn record_edge_refactor_meta_from_pending(
        &mut self,
        edge_id: Uuid,
        object_id: Option<Uuid>,
        source_range: SourceRange,
        face_ids: Option<[Uuid; 2]>,
    ) -> bool {
        let exact_meta_index = self.mod_local.artifacts.refactor_metadata.iter().position(|meta| {
            matches!(
                meta,
                RefactorMetadata::EdgeRefactor(meta)
                    if meta.edge_id == edge_id && meta.source_range == source_range
            )
        });

        let unique_edge_meta_index = || {
            let mut matches = self
                .mod_local
                .artifacts
                .refactor_metadata
                .iter()
                .enumerate()
                .filter_map(|(index, meta)| match meta {
                    RefactorMetadata::EdgeRefactor(meta) if meta.edge_id == edge_id => Some(index),
                    _ => None,
                });
            let index = matches.next()?;
            matches.next().is_none().then_some(index)
        };

        let Some(meta_index) = exact_meta_index.or_else(unique_edge_meta_index) else {
            return false;
        };
        let RefactorMetadata::EdgeRefactor(existing_meta) = &mut self.mod_local.artifacts.refactor_metadata[meta_index]
        else {
            return false;
        };

        if object_id.is_some() {
            existing_meta.object_id = object_id;
        }
        if existing_meta.face_ids.is_none() {
            existing_meta.face_ids = face_ids;
        }

        true
    }

    /// Record metadata from a fillet/chamfer call that used `tags` directly.
    ///
    /// This is intentionally collected unconditionally when artifact graph support is enabled.
    /// The temporary feature flag only controls whether the lint/action is shown in the app.
    pub(crate) fn record_direct_tag_fillet_meta(&mut self, meta: DirectTagFilletMeta) {
        self.mod_local
            .artifacts
            .refactor_metadata
            .push(RefactorMetadata::DirectTagFillet(meta));
    }

    /// Refactor metadata collected when deprecated edge stdlib functions run (for tests and lint).
    pub fn edge_refactor_metadata(&self) -> Vec<EdgeRefactorMeta> {
        self.global
            .root_module_artifacts
            .refactor_metadata
            .iter()
            .filter_map(|m| match m {
                RefactorMetadata::EdgeRefactor(meta) => Some(meta.clone()),
                RefactorMetadata::DirectTagFillet(_) => None,
            })
            .collect()
    }

    /// Direct-tag fillet/chamfer metadata (for Z0006 code mod).
    pub fn direct_tag_fillet_metadata(&self) -> Vec<DirectTagFilletMeta> {
        self.global
            .root_module_artifacts
            .refactor_metadata
            .iter()
            .filter_map(|m| match m {
                RefactorMetadata::EdgeRefactor(_) => None,
                RefactorMetadata::DirectTagFillet(meta) => Some(meta.clone()),
            })
            .collect()
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
            self.issues().to_vec(),
            main_ref
                .and_then(|main_ref| self.mod_local.variables(main_ref).ok())
                .unwrap_or_default(),
            self.global.operations_by_module(),
            Default::default(),
            self.global.artifacts.graph.clone(),
            self.global.root_module_artifacts.scene_objects.clone(),
            self.global.root_module_artifacts.source_range_to_object.clone(),
            self.global.root_module_artifacts.var_solutions.clone(),
            self.global.root_module_artifacts.refactor_metadata.clone(),
            module_id_to_module_path,
            self.global.id_to_source.clone(),
            default_planes,
        )
    }

    pub(crate) fn build_program_lookup(
        &self,
        current: crate::parsing::ast::types::Node<crate::parsing::ast::types::Program>,
    ) -> ProgramLookup {
        ProgramLookup::new(current, self.global.module_infos.clone())
    }

    pub(crate) async fn build_artifact_graph(
        &mut self,
        engine: &Arc<EngineManager>,
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
        for (id, exec_artifact) in new_exec_artifacts {
            // Only insert if it wasn't already present. We don't want to
            // overwrite what was previously there. We haven't filled in node
            // paths yet.
            self.global.artifacts.artifacts.entry(id).or_insert(exec_artifact);
        }

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

        #[cfg(feature = "snapshot-engine-responses")]
        {
            // Store engine responses for debugging.
            self.global.root_module_artifacts.responses.extend(new_responses);
        }

        let artifact_graph = graph_result?;
        self.global.artifacts.graph = artifact_graph;

        Ok(())
    }

    pub(crate) fn kcl_version(&self) -> KclVersion {
        self.mod_local.settings.kcl_version.parse().unwrap_or_default()
    }
}

#[derive(Default)]
pub enum KclVersion {
    #[default]
    V1,
    V2,
}

impl FromStr for KclVersion {
    type Err = KclError;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "1" | "1.0" | "1.0.0" => Ok(Self::V1),
            "2" | "2.0" | "2.0.0" => Ok(Self::V2),
            other => Err(KclError::new_semantic(KclErrorDetails {
                source_ranges: Default::default(),
                backtrace: Default::default(),
                message: format!("Unrecognized version {other}. Valid versions are 1.0 and 2.0"),
            })),
        }
    }
}

impl GlobalState {
    fn new(settings: &ExecutorSettings, segment_ids_edited: AhashIndexSet<ObjectId>) -> Self {
        let mut global = GlobalState {
            path_to_source_id: Default::default(),
            module_infos: Default::default(),
            artifacts: Default::default(),
            root_module_artifacts: Default::default(),
            mod_loader: Default::default(),
            issues: Default::default(),
            id_to_source: Default::default(),
            segment_ids_edited,
            drag_anchors: Vec::new(),
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
    pub fn cached_body_items(&self) -> usize {
        self.graph.item_count
    }

    pub(crate) fn clear(&mut self) {
        self.artifacts.clear();
        self.graph.clear();
    }
}

impl ModuleArtifactState {
    pub(crate) fn clear(&mut self) {
        self.artifacts.clear();
        self.unprocessed_commands.clear();
        self.commands.clear();
        self.operations.clear();
        self.refactor_metadata.clear();
    }

    pub(crate) fn restore_scene_objects(&mut self, scene_objects: &[Object]) {
        self.scene_objects = scene_objects.to_vec();
        self.object_id_generator = IncIdGenerator::new(self.scene_objects.len());
        self.source_range_to_object.clear();
        self.artifact_id_to_scene_object.clear();

        for (expected_id, object) in self.scene_objects.iter().enumerate() {
            debug_assert_eq!(
                object.id.0, expected_id,
                "Restored cached scene object ID {} does not match its position {}",
                object.id.0, expected_id
            );

            match &object.kind {
                ObjectKind::Wall(wall) => {
                    self.source_range_to_object.insert(wall.source.solid.range, object.id);
                }
                ObjectKind::Cap(cap) => {
                    self.source_range_to_object.insert(cap.source.solid.range, object.id);
                }
                _ => match &object.source {
                    crate::front::SourceRef::Simple { range, node_path: _ } => {
                        self.source_range_to_object.insert(*range, object.id);
                    }
                    crate::front::SourceRef::BackTrace { ranges } => {
                        // Don't map the entire backtrace, only the most specific
                        // range.
                        if let Some((range, _)) = ranges.first() {
                            self.source_range_to_object.insert(*range, object.id);
                        }
                    }
                },
            }

            // Ignore placeholder artifacts.
            if object.artifact_id != ArtifactId::placeholder() {
                self.artifact_id_to_scene_object.insert(object.artifact_id, object.id);
            }
        }
    }

    /// When self is a cached state, extend it with new state.
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
        self.refactor_metadata.extend(other.refactor_metadata);
    }

    // Move unprocessed artifact commands so that we don't try to process them
    // again next time due to execution caching.  Returns a clone of the
    // commands that were moved.
    pub(crate) fn process_commands(&mut self) -> Vec<ArtifactCommand> {
        let unprocessed = std::mem::take(&mut self.unprocessed_commands);
        let new_module_commands = unprocessed.clone();
        self.commands.extend(unprocessed);
        new_module_commands
    }

    pub(crate) fn scene_object_by_id(&self, id: ObjectId) -> Option<&Object> {
        debug_assert!(
            id.0 < self.scene_objects.len(),
            "Requested object ID {} but only have {} objects",
            id.0,
            self.scene_objects.len()
        );
        self.scene_objects.get(id.0)
    }

    pub(crate) fn scene_object_by_id_mut(&mut self, id: ObjectId) -> Option<&mut Object> {
        debug_assert!(
            id.0 < self.scene_objects.len(),
            "Requested object ID {} but only have {} objects",
            id.0,
            self.scene_objects.len()
        );
        self.scene_objects.get_mut(id.0)
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
        let state_module_id = module_id.unwrap_or_default();
        ModuleState {
            module_id: state_module_id,
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
            constraint_state: Default::default(),
            allowed_warnings: Vec::new(),
            denied_warnings: Vec::new(),
            consumed_solids: AHashMap::default(),
            consumed_solid_ids: AHashMap::default(),
            inside_stdlib: false,
        }
    }

    pub(super) fn variables(&self, main_ref: EnvironmentRef) -> Result<IndexMap<String, KclValue>, KclError> {
        self.stack.find_all_in_env_owned(main_ref)
    }
}

impl SketchBlockState {
    pub(crate) fn next_sketch_var_id(&self) -> SketchVarId {
        SketchVarId(self.sketch_vars.len())
    }

    /// Given a solve outcome, return the solutions for the sketch variables and
    /// enough information to update them in the source.
    pub(crate) fn var_solutions(
        &self,
        solve_outcome: &Solved,
        solution_ty: NumericType,
        sketch_block_range: SourceRange,
    ) -> Result<Vec<(SourceRange, Option<NodePath>, Number)>, KclError> {
        self.sketch_vars
            .iter()
            .map(|v| {
                let Some(sketch_var) = v.as_sketch_var() else {
                    return Err(KclError::new_internal(KclErrorDetails::new(
                        "Expected sketch variable".to_owned(),
                        vec![sketch_block_range],
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
                            vec![sketch_block_range],
                        ))
                    })?,
                };
                let Some(source_range) = sketch_var.meta.first().map(|m| m.source_range) else {
                    return Ok(None);
                };
                Ok(Some((source_range, sketch_var.node_path.clone(), solved_value)))
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

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::ModuleArtifactState;
    use crate::NodePath;
    use crate::NodePathExt;
    use crate::SourceRange;
    use crate::execution::ArtifactId;
    use crate::front::Object;
    use crate::front::ObjectId;
    use crate::front::ObjectKind;
    use crate::front::Plane;
    use crate::front::SourceRef;

    #[test]
    fn restore_scene_objects_rebuilds_lookup_maps() {
        let plane_artifact_id = ArtifactId::new(Uuid::from_u128(1));
        let sketch_artifact_id = ArtifactId::new(Uuid::from_u128(2));
        let plane_range = SourceRange::from([1, 4, 0]);
        let plane_node_path = Some(NodePath::placeholder());
        let sketch_ranges = vec![
            (SourceRange::from([5, 9, 0]), None),
            (SourceRange::from([10, 12, 0]), None),
        ];
        let cached_objects = vec![
            Object {
                id: ObjectId(0),
                kind: ObjectKind::Plane(Plane::Object(ObjectId(0))),
                label: Default::default(),
                comments: Default::default(),
                artifact_id: plane_artifact_id,
                source: SourceRef::new(plane_range, plane_node_path),
            },
            Object {
                id: ObjectId(1),
                kind: ObjectKind::Nil,
                label: Default::default(),
                comments: Default::default(),
                artifact_id: sketch_artifact_id,
                source: SourceRef::BackTrace {
                    ranges: sketch_ranges.clone(),
                },
            },
            Object::placeholder(ObjectId(2), SourceRange::from([13, 14, 0]), None),
        ];

        let mut artifacts = ModuleArtifactState::default();
        artifacts.restore_scene_objects(&cached_objects);

        assert_eq!(artifacts.scene_objects, cached_objects);
        assert_eq!(
            artifacts.artifact_id_to_scene_object.get(&plane_artifact_id),
            Some(&ObjectId(0))
        );
        assert_eq!(
            artifacts.artifact_id_to_scene_object.get(&sketch_artifact_id),
            Some(&ObjectId(1))
        );
        assert_eq!(
            artifacts.artifact_id_to_scene_object.get(&ArtifactId::placeholder()),
            None
        );
        assert_eq!(artifacts.source_range_to_object.get(&plane_range), Some(&ObjectId(0)));
        assert_eq!(
            artifacts.source_range_to_object.get(&sketch_ranges[0].0),
            Some(&ObjectId(1))
        );
        // We don't map all the ranges in a backtrace.
        assert_eq!(artifacts.source_range_to_object.get(&sketch_ranges[1].0), None);
    }
}
