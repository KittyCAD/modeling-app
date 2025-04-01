//! The executor for the AST.

use std::{path::PathBuf, sync::Arc};

use anyhow::Result;
pub use artifact::{
    Artifact, ArtifactCommand, ArtifactGraph, ArtifactId, CodeRef, StartSketchOnFace, StartSketchOnPlane,
};
use cache::OldAstState;
pub use cache::{bust_cache, clear_mem_cache};
pub use cad_op::Operation;
pub use geometry::*;
pub use id_generator::IdGenerator;
pub(crate) use import::{
    import_foreign, send_to_engine as send_import_to_engine, PreImportedGeometry, ZOO_COORD_SYSTEM,
};
use indexmap::IndexMap;
pub use kcl_value::{KclObjectFields, KclValue};
use kcmc::{
    each_cmd as mcmd,
    ok_response::{output::TakeSnapshot, OkModelingCmdResponse},
    websocket::{ModelingSessionData, OkWebSocketResponseData},
    ImageFormat, ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
pub use memory::EnvironmentRef;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
pub use state::{ExecState, MetaSettings};
use tokio::task::JoinSet;

use crate::{
    engine::EngineManager,
    errors::KclError,
    execution::{
        artifact::build_artifact_graph,
        cache::{CacheInformation, CacheResult},
        types::{UnitAngle, UnitLen},
    },
    fs::FileManager,
    modules::{ModuleId, ModulePath},
    parsing::ast::types::{Expr, ImportPath, NodeRef},
    source_range::SourceRange,
    std::StdLib,
    CompilationError, ExecError, ExecutionKind, KclErrorWithOutputs,
};

pub(crate) mod annotations;
mod artifact;
pub(crate) mod cache;
mod cad_op;
mod exec_ast;
mod geometry;
mod id_generator;
mod import;
pub(crate) mod kcl_value;
mod memory;
mod state;
pub(crate) mod types;

/// Outcome of executing a program.  This is used in TS.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutcome {
    /// Variables in the top-level of the root module. Note that functions will have an invalid env ref.
    pub variables: IndexMap<String, KclValue>,
    /// Operations that have been performed in execution order, for display in
    /// the Feature Tree.
    pub operations: Vec<Operation>,
    /// Output commands to allow building the artifact graph by the caller.
    pub artifact_commands: Vec<ArtifactCommand>,
    /// Output artifact graph.
    pub artifact_graph: ArtifactGraph,
    /// Non-fatal errors and warnings.
    pub errors: Vec<CompilationError>,
    /// File Names in module Id array index order
    pub filenames: IndexMap<ModuleId, ModulePath>,
    /// The default planes.
    pub default_planes: Option<DefaultPlanes>,
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DefaultPlanes {
    pub xy: uuid::Uuid,
    pub xz: uuid::Uuid,
    pub yz: uuid::Uuid,
    pub neg_xy: uuid::Uuid,
    pub neg_xz: uuid::Uuid,
    pub neg_yz: uuid::Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct TagIdentifier {
    pub value: String,
    // Multi-version representation of info about the tag. Kept ordered. The usize is the epoch at which the info
    // was written. Note that there might be multiple versions of tag info from the same epoch, the version with
    // the higher index will be the most recent.
    #[serde(skip)]
    pub info: Vec<(usize, TagEngineInfo)>,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

impl TagIdentifier {
    /// Get the tag info for this tag at a specified epoch.
    pub fn get_info(&self, at_epoch: usize) -> Option<&TagEngineInfo> {
        for (e, info) in self.info.iter().rev() {
            if *e <= at_epoch {
                return Some(info);
            }
        }

        None
    }

    /// Get the most recent tag info for this tag.
    pub fn get_cur_info(&self) -> Option<&TagEngineInfo> {
        self.info.last().map(|i| &i.1)
    }

    /// Add info from a different instance of this tag.
    pub fn merge_info(&mut self, other: &TagIdentifier) {
        assert_eq!(&self.value, &other.value);
        'new_info: for (oe, ot) in &other.info {
            for (e, _) in &self.info {
                if e > oe {
                    continue 'new_info;
                }
            }
            self.info.push((*oe, ot.clone()));
        }
    }
}

impl Eq for TagIdentifier {}

impl std::fmt::Display for TagIdentifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.value)
    }
}

impl std::str::FromStr for TagIdentifier {
    type Err = KclError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self {
            value: s.to_string(),
            info: Vec::new(),
            meta: Default::default(),
        })
    }
}

impl Ord for TagIdentifier {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.value.cmp(&other.value)
    }
}

impl PartialOrd for TagIdentifier {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl std::hash::Hash for TagIdentifier {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.value.hash(state);
    }
}

/// Engine information for a tag.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct TagEngineInfo {
    /// The id of the tagged object.
    pub id: uuid::Uuid,
    /// The sketch the tag is on.
    pub sketch: uuid::Uuid,
    /// The path the tag is on.
    pub path: Option<Path>,
    /// The surface information for the tag.
    pub surface: Option<ExtrudeSurface>,
}

#[derive(Debug, Copy, Clone, Deserialize, Serialize, PartialEq)]
pub enum BodyType {
    Root,
    Block,
}

/// Metadata.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Eq, Copy)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    /// The source range.
    pub source_range: SourceRange,
}

impl From<Metadata> for Vec<SourceRange> {
    fn from(meta: Metadata) -> Self {
        vec![meta.source_range]
    }
}

impl From<SourceRange> for Metadata {
    fn from(source_range: SourceRange) -> Self {
        Self { source_range }
    }
}

impl<T> From<NodeRef<'_, T>> for Metadata {
    fn from(node: NodeRef<'_, T>) -> Self {
        Self {
            source_range: SourceRange::new(node.start, node.end, node.module_id),
        }
    }
}

impl From<&Expr> for Metadata {
    fn from(expr: &Expr) -> Self {
        Self {
            source_range: SourceRange::from(expr),
        }
    }
}

/// The type of ExecutorContext being used
#[derive(PartialEq, Debug, Default, Clone)]
pub enum ContextType {
    /// Live engine connection
    #[default]
    Live,

    /// Completely mocked connection
    /// Mock mode is only for the modeling app when they just want to mock engine calls and not
    /// actually make them.
    Mock,

    /// Handled by some other interpreter/conversion system
    MockCustomForwarded,
}

/// The executor context.
/// Cloning will return another handle to the same engine connection/session,
/// as this uses `Arc` under the hood.
#[derive(Debug, Clone)]
pub struct ExecutorContext {
    pub engine: Arc<Box<dyn EngineManager>>,
    pub fs: Arc<FileManager>,
    pub stdlib: Arc<StdLib>,
    pub settings: ExecutorSettings,
    pub context_type: ContextType,
}

/// The executor settings.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct ExecutorSettings {
    /// Highlight edges of 3D objects?
    pub highlight_edges: bool,
    /// Whether or not Screen Space Ambient Occlusion (SSAO) is enabled.
    pub enable_ssao: bool,
    /// Show grid?
    pub show_grid: bool,
    /// Should engine store this for replay?
    /// If so, under what name?
    pub replay: Option<String>,
    /// The directory of the current project.  This is used for resolving import
    /// paths.  If None is given, the current working directory is used.
    pub project_directory: Option<PathBuf>,
    /// This is the path to the current file being executed.
    /// We use this for preventing cyclic imports.
    pub current_file: Option<PathBuf>,
}

impl Default for ExecutorSettings {
    fn default() -> Self {
        Self {
            highlight_edges: true,
            enable_ssao: false,
            show_grid: false,
            replay: None,
            project_directory: None,
            current_file: None,
        }
    }
}

impl From<crate::settings::types::Configuration> for ExecutorSettings {
    fn from(config: crate::settings::types::Configuration) -> Self {
        Self {
            highlight_edges: config.settings.modeling.highlight_edges.into(),
            enable_ssao: config.settings.modeling.enable_ssao.into(),
            show_grid: config.settings.modeling.show_scale_grid,
            replay: None,
            project_directory: None,
            current_file: None,
        }
    }
}

impl From<crate::settings::types::project::ProjectConfiguration> for ExecutorSettings {
    fn from(config: crate::settings::types::project::ProjectConfiguration) -> Self {
        Self {
            highlight_edges: config.settings.modeling.highlight_edges.into(),
            enable_ssao: config.settings.modeling.enable_ssao.into(),
            show_grid: Default::default(),
            replay: None,
            project_directory: None,
            current_file: None,
        }
    }
}

impl From<crate::settings::types::ModelingSettings> for ExecutorSettings {
    fn from(modeling: crate::settings::types::ModelingSettings) -> Self {
        Self {
            highlight_edges: modeling.highlight_edges.into(),
            enable_ssao: modeling.enable_ssao.into(),
            show_grid: modeling.show_scale_grid,
            replay: None,
            project_directory: None,
            current_file: None,
        }
    }
}

impl From<crate::settings::types::project::ProjectModelingSettings> for ExecutorSettings {
    fn from(modeling: crate::settings::types::project::ProjectModelingSettings) -> Self {
        Self {
            highlight_edges: modeling.highlight_edges.into(),
            enable_ssao: modeling.enable_ssao.into(),
            show_grid: Default::default(),
            replay: None,
            project_directory: None,
            current_file: None,
        }
    }
}

impl ExecutorSettings {
    /// Add the current file path to the executor settings.
    pub fn with_current_file(&mut self, current_file: PathBuf) {
        // We want the parent directory of the file.
        if current_file.extension() == Some(std::ffi::OsStr::new("kcl")) {
            self.current_file = Some(current_file.clone());
            // Get the parent directory.
            if let Some(parent) = current_file.parent() {
                self.project_directory = Some(parent.to_path_buf());
            } else {
                self.project_directory = Some(std::path::PathBuf::from(""));
            }
        } else {
            self.project_directory = Some(current_file.clone());
        }
    }
}

impl ExecutorContext {
    /// Create a new default executor context.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new(client: &kittycad::Client, settings: ExecutorSettings) -> Result<Self> {
        let (ws, _headers) = client
            .modeling()
            .commands_ws(
                None,
                None,
                if settings.enable_ssao {
                    Some(kittycad::types::PostEffectType::Ssao)
                } else {
                    None
                },
                settings.replay.clone(),
                if settings.show_grid { Some(true) } else { None },
                None,
                None,
                None,
                Some(false),
            )
            .await?;

        let engine: Arc<Box<dyn EngineManager>> =
            Arc::new(Box::new(crate::engine::conn::EngineConnection::new(ws).await?));

        Ok(Self {
            engine,
            fs: Arc::new(FileManager::new()),
            stdlib: Arc::new(StdLib::new()),
            settings,
            context_type: ContextType::Live,
        })
    }

    #[cfg(target_arch = "wasm32")]
    pub fn new(engine: Arc<Box<dyn EngineManager>>, fs: Arc<FileManager>, settings: ExecutorSettings) -> Self {
        ExecutorContext {
            engine,
            fs,
            stdlib: Arc::new(StdLib::new()),
            settings,
            context_type: ContextType::Live,
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new_mock() -> Self {
        ExecutorContext {
            engine: Arc::new(Box::new(
                crate::engine::conn_mock::EngineConnection::new().await.unwrap(),
            )),
            fs: Arc::new(FileManager::new()),
            stdlib: Arc::new(StdLib::new()),
            settings: Default::default(),
            context_type: ContextType::Mock,
        }
    }

    #[cfg(target_arch = "wasm32")]
    pub fn new_mock(engine: Arc<Box<dyn EngineManager>>, fs: Arc<FileManager>, settings: ExecutorSettings) -> Self {
        ExecutorContext {
            engine,
            fs,
            stdlib: Arc::new(StdLib::new()),
            settings,
            context_type: ContextType::Mock,
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn new_forwarded_mock(engine: Arc<Box<dyn EngineManager>>) -> Self {
        ExecutorContext {
            engine,
            fs: Arc::new(FileManager::new()),
            stdlib: Arc::new(StdLib::new()),
            settings: Default::default(),
            context_type: ContextType::MockCustomForwarded,
        }
    }

    /// Create a new default executor context.
    /// With a kittycad client.
    /// This allows for passing in `ZOO_API_TOKEN` and `ZOO_HOST` as environment
    /// variables.
    /// But also allows for passing in a token and engine address directly.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new_with_client(
        settings: ExecutorSettings,
        token: Option<String>,
        engine_addr: Option<String>,
    ) -> Result<Self> {
        // Create the client.
        let client = crate::engine::new_zoo_client(token, engine_addr)?;

        let ctx = Self::new(&client, settings).await?;
        Ok(ctx)
    }

    /// Create a new default executor context.
    /// With the default kittycad client.
    /// This allows for passing in `ZOO_API_TOKEN` and `ZOO_HOST` as environment
    /// variables.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new_with_default_client() -> Result<Self> {
        // Create the client.
        let ctx = Self::new_with_client(Default::default(), None, None).await?;
        Ok(ctx)
    }

    /// For executing unit tests.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new_for_unit_test(engine_addr: Option<String>) -> Result<Self> {
        let ctx = ExecutorContext::new_with_client(
            ExecutorSettings {
                highlight_edges: true,
                enable_ssao: false,
                show_grid: false,
                replay: None,
                project_directory: None,
                current_file: None,
            },
            None,
            engine_addr,
        )
        .await?;
        Ok(ctx)
    }

    pub fn is_mock(&self) -> bool {
        self.context_type == ContextType::Mock || self.context_type == ContextType::MockCustomForwarded
    }

    /// Returns true if we should not send engine commands for any reason.
    pub async fn no_engine_commands(&self) -> bool {
        self.is_mock() || self.engine.execution_kind().await.is_isolated()
    }

    pub async fn send_clear_scene(
        &self,
        exec_state: &mut ExecState,
        source_range: crate::execution::SourceRange,
    ) -> Result<(), KclError> {
        self.engine
            .clear_scene(&mut exec_state.mod_local.id_generator, source_range)
            .await
    }

    pub async fn bust_cache_and_reset_scene(&self) -> Result<ExecOutcome, KclErrorWithOutputs> {
        cache::bust_cache().await;

        // Execute an empty program to clear and reset the scene.
        // We specifically want to be returned the objects after the scene is reset.
        // Like the default planes so it is easier to just execute an empty program
        // after the cache is busted.
        let outcome = self.run_with_caching(crate::Program::empty()).await?;

        Ok(outcome)
    }

    async fn prepare_mem(&self, exec_state: &mut ExecState) -> Result<(), KclErrorWithOutputs> {
        self.eval_prelude(exec_state, SourceRange::synthetic())
            .await
            .map_err(KclErrorWithOutputs::no_outputs)?;
        exec_state.mut_stack().push_new_root_env(true);
        Ok(())
    }

    pub async fn run_mock(
        &self,
        program: crate::Program,
        use_prev_memory: bool,
    ) -> Result<ExecOutcome, KclErrorWithOutputs> {
        assert!(self.is_mock());

        let mut exec_state = ExecState::new(self);
        if use_prev_memory {
            match cache::read_old_memory().await {
                Some(mem) => {
                    *exec_state.mut_stack() = mem.0;
                    exec_state.global.module_infos = mem.1;
                }
                None => self.prepare_mem(&mut exec_state).await?,
            }
        } else {
            self.prepare_mem(&mut exec_state).await?
        };

        // Push a scope so that old variables can be overwritten (since we might be re-executing some
        // part of the scene).
        exec_state.mut_stack().push_new_env_for_scope();

        let result = self.inner_run(&program, &mut exec_state, true).await?;

        // Restore any temporary variables, then save any newly created variables back to
        // memory in case another run wants to use them. Note this is just saved to the preserved
        // memory, not to the exec_state which is not cached for mock execution.

        let mut mem = exec_state.stack().clone();
        let module_infos = exec_state.global.module_infos.clone();
        let outcome = exec_state.to_mock_wasm_outcome(result.0).await;

        mem.squash_env(result.0);
        cache::write_old_memory((mem, module_infos)).await;

        Ok(outcome)
    }

    pub async fn run_with_caching(&self, program: crate::Program) -> Result<ExecOutcome, KclErrorWithOutputs> {
        assert!(!self.is_mock());

        let (program, mut exec_state, preserve_mem) = if let Some(OldAstState {
            ast: old_ast,
            exec_state: mut old_state,
            settings: old_settings,
            result_env,
        }) = cache::read_old_ast().await
        {
            let old = CacheInformation {
                ast: &old_ast,
                settings: &old_settings,
            };
            let new = CacheInformation {
                ast: &program.ast,
                settings: &self.settings,
            };

            // Get the program that actually changed from the old and new information.
            let (clear_scene, program) = match cache::get_changed_program(old, new).await {
                CacheResult::ReExecute {
                    clear_scene,
                    reapply_settings,
                    program: changed_program,
                } => {
                    if reapply_settings
                        && self
                            .engine
                            .reapply_settings(&self.settings, Default::default(), old_state.id_generator())
                            .await
                            .is_err()
                    {
                        (true, program)
                    } else {
                        (
                            clear_scene,
                            crate::Program {
                                ast: changed_program,
                                original_file_contents: program.original_file_contents,
                            },
                        )
                    }
                }
                CacheResult::NoAction(true) => {
                    if self
                        .engine
                        .reapply_settings(&self.settings, Default::default(), old_state.id_generator())
                        .await
                        .is_ok()
                    {
                        // We need to update the old ast state with the new settings!!
                        cache::write_old_ast(OldAstState {
                            ast: old_ast,
                            exec_state: old_state.clone(),
                            settings: self.settings.clone(),
                            result_env,
                        })
                        .await;

                        let outcome = old_state.to_wasm_outcome(result_env).await;
                        return Ok(outcome);
                    }
                    (true, program)
                }
                CacheResult::NoAction(false) => {
                    let outcome = old_state.to_wasm_outcome(result_env).await;
                    return Ok(outcome);
                }
            };

            let (exec_state, preserve_mem) = if clear_scene {
                // Pop the execution state, since we are starting fresh.
                let mut exec_state = old_state;
                exec_state.reset(self);

                // We don't do this in mock mode since there is no engine connection
                // anyways and from the TS side we override memory and don't want to clear it.
                self.send_clear_scene(&mut exec_state, Default::default())
                    .await
                    .map_err(KclErrorWithOutputs::no_outputs)?;

                (exec_state, false)
            } else {
                old_state.mut_stack().restore_env(result_env);

                (old_state, true)
            };

            (program, exec_state, preserve_mem)
        } else {
            let mut exec_state = ExecState::new(self);
            self.send_clear_scene(&mut exec_state, Default::default())
                .await
                .map_err(KclErrorWithOutputs::no_outputs)?;
            (program, exec_state, false)
        };

        let result = self.inner_run(&program, &mut exec_state, preserve_mem).await;

        if result.is_err() {
            cache::bust_cache().await;
        }

        // Throw the error.
        let result = result?;

        // Save this as the last successful execution to the cache.
        cache::write_old_ast(OldAstState {
            ast: program.ast,
            exec_state: exec_state.clone(),
            settings: self.settings.clone(),
            result_env: result.0,
        })
        .await;

        let outcome = exec_state.to_wasm_outcome(result.0).await;
        Ok(outcome)
    }

    /// Perform the execution of a program.
    ///
    /// You can optionally pass in some initialization memory for partial
    /// execution.
    ///
    /// To access non-fatal errors and warnings, extract them from the `ExecState`.
    pub async fn run(
        &self,
        program: &crate::Program,
        exec_state: &mut ExecState,
    ) -> Result<(EnvironmentRef, Option<ModelingSessionData>), KclErrorWithOutputs> {
        self.inner_run(program, exec_state, false).await
    }

    /// Perform the execution of a program using an (experimental!) concurrent
    /// execution model. This has the same signature as [Self::run].
    ///
    /// For now -- do not use this unless you're willing to accept some
    /// breakage.
    ///
    /// You can optionally pass in some initialization memory for partial
    /// execution.
    ///
    /// To access non-fatal errors and warnings, extract them from the `ExecState`.
    pub async fn run_concurrent(
        &self,
        program: &crate::Program,
        exec_state: &mut ExecState,
    ) -> Result<(EnvironmentRef, Option<ModelingSessionData>), KclErrorWithOutputs> {
        self.prepare_mem(exec_state).await.unwrap();

        let mut universe = std::collections::HashMap::new();

        crate::walk::import_universe(self, &program.ast, &mut universe)
            .await
            .unwrap();

        for modules in crate::walk::import_graph(&universe).unwrap().into_iter() {
            let mut set = JoinSet::new();

            for module in modules {
                let program = universe.get(&module).unwrap().clone();
                let module = module.clone();
                let mut exec_state = exec_state.clone();
                let exec_ctxt = self.clone();

                set.spawn(async move {
                    let module = module;
                    let mut exec_state = exec_state;
                    let exec_ctxt = exec_ctxt;
                    let program = program;

                    exec_ctxt
                        .run(
                            &crate::Program {
                                ast: program.clone(),
                                original_file_contents: "".to_owned(),
                            },
                            &mut exec_state,
                        )
                        .await
                });
            }

            set.join_all().await;
        }

        self.run(&program, exec_state).await
    }

    /// Perform the execution of a program.  Accept all possible parameters and
    /// output everything.
    async fn inner_run(
        &self,
        program: &crate::Program,
        exec_state: &mut ExecState,
        preserve_mem: bool,
    ) -> Result<(EnvironmentRef, Option<ModelingSessionData>), KclErrorWithOutputs> {
        exec_state.add_root_module_contents(program);

        let _stats = crate::log::LogPerfStats::new("Interpretation");

        // Re-apply the settings, in case the cache was busted.
        self.engine
            .reapply_settings(&self.settings, Default::default(), exec_state.id_generator())
            .await
            .map_err(KclErrorWithOutputs::no_outputs)?;

        let default_planes = self.engine.get_default_planes().read().await.clone();
        let result = self
            .execute_and_build_graph(&program.ast, exec_state, preserve_mem)
            .await;

        crate::log::log(format!(
            "Post interpretation KCL memory stats: {:#?}",
            exec_state.stack().memory.stats
        ));
        crate::log::log(format!("Engine stats: {:?}", self.engine.stats()));

        let env_ref = result.map_err(|e| {
            let module_id_to_module_path: IndexMap<ModuleId, ModulePath> = exec_state
                .global
                .path_to_source_id
                .iter()
                .map(|(k, v)| ((*v), k.clone()))
                .collect();

            KclErrorWithOutputs::new(
                e,
                exec_state.global.operations.clone(),
                exec_state.global.artifact_commands.clone(),
                exec_state.global.artifact_graph.clone(),
                module_id_to_module_path,
                exec_state.global.id_to_source.clone(),
                default_planes,
            )
        })?;

        if !self.is_mock() {
            let mut mem = exec_state.stack().deep_clone();
            mem.restore_env(env_ref);
            cache::write_old_memory((mem, exec_state.global.module_infos.clone())).await;
        }
        let session_data = self.engine.get_session_data().await;
        Ok((env_ref, session_data))
    }

    /// Execute an AST's program and build auxiliary outputs like the artifact
    /// graph.
    async fn execute_and_build_graph(
        &self,
        program: NodeRef<'_, crate::parsing::ast::types::Program>,
        exec_state: &mut ExecState,
        preserve_mem: bool,
    ) -> Result<EnvironmentRef, KclError> {
        // Don't early return!  We need to build other outputs regardless of
        // whether execution failed.

        self.eval_prelude(exec_state, SourceRange::from(program).start_as_range())
            .await?;

        let exec_result = self
            .exec_module_body(
                program,
                exec_state,
                ExecutionKind::Normal,
                preserve_mem,
                ModuleId::default(),
                &ModulePath::Main,
            )
            .await;

        // If we errored out and early-returned, there might be commands which haven't been executed
        // and should be dropped.
        self.engine.clear_queues().await;

        // Move the artifact commands and responses to simplify cache management
        // and error creation.
        exec_state
            .global
            .artifact_commands
            .extend(self.engine.take_artifact_commands().await);
        exec_state
            .global
            .artifact_responses
            .extend(self.engine.take_responses().await);
        // Build the artifact graph.
        match build_artifact_graph(
            &exec_state.global.artifact_commands,
            &exec_state.global.artifact_responses,
            program,
            &exec_state.global.artifacts,
        ) {
            Ok(artifact_graph) => {
                exec_state.global.artifact_graph = artifact_graph;
                exec_result.map(|(_, env_ref, _)| env_ref)
            }
            Err(err) => {
                // Prefer the exec error.
                exec_result.and(Err(err))
            }
        }
    }

    /// 'Import' std::prelude as the outermost scope.
    ///
    /// SAFETY: the current thread must have sole access to the memory referenced in exec_state.
    async fn eval_prelude(&self, exec_state: &mut ExecState, source_range: SourceRange) -> Result<(), KclError> {
        if exec_state.stack().memory.requires_std() {
            let id = self
                .open_module(
                    &ImportPath::Std {
                        path: vec!["std".to_owned(), "prelude".to_owned()],
                    },
                    &[],
                    exec_state,
                    source_range,
                )
                .await?;
            let (module_memory, _) = self
                .exec_module_for_items(id, exec_state, ExecutionKind::Isolated, source_range)
                .await?;

            exec_state.mut_stack().memory.set_std(module_memory);
        }

        Ok(())
    }

    /// Get a snapshot of the current scene.
    pub async fn prepare_snapshot(&self) -> std::result::Result<TakeSnapshot, ExecError> {
        // Zoom to fit.
        self.engine
            .send_modeling_cmd(
                uuid::Uuid::new_v4(),
                crate::execution::SourceRange::default(),
                &ModelingCmd::from(mcmd::ZoomToFit {
                    object_ids: Default::default(),
                    animated: false,
                    padding: 0.1,
                }),
            )
            .await
            .map_err(KclErrorWithOutputs::no_outputs)?;

        // Send a snapshot request to the engine.
        let resp = self
            .engine
            .send_modeling_cmd(
                uuid::Uuid::new_v4(),
                crate::execution::SourceRange::default(),
                &ModelingCmd::from(mcmd::TakeSnapshot {
                    format: ImageFormat::Png,
                }),
            )
            .await
            .map_err(KclErrorWithOutputs::no_outputs)?;

        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::TakeSnapshot(contents),
        } = resp
        else {
            return Err(ExecError::BadPng(format!(
                "Instead of a TakeSnapshot response, the engine returned {resp:?}"
            )));
        };
        Ok(contents)
    }

    /// Export the current scene as a CAD file.
    pub async fn export(
        &self,
        format: kittycad_modeling_cmds::format::OutputFormat3d,
    ) -> Result<Vec<kittycad_modeling_cmds::websocket::RawFile>, KclError> {
        let resp = self
            .engine
            .send_modeling_cmd(
                uuid::Uuid::new_v4(),
                crate::SourceRange::default(),
                &kittycad_modeling_cmds::ModelingCmd::Export(kittycad_modeling_cmds::Export {
                    entity_ids: vec![],
                    format,
                }),
            )
            .await?;

        let kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Export { files } = resp else {
            return Err(KclError::Internal(crate::errors::KclErrorDetails {
                message: format!("Expected Export response, got {resp:?}",),
                source_ranges: vec![SourceRange::default()],
            }));
        };

        Ok(files)
    }

    /// Export the current scene as a STEP file.
    pub async fn export_step(
        &self,
        deterministic_time: bool,
    ) -> Result<Vec<kittycad_modeling_cmds::websocket::RawFile>, KclError> {
        let files = self
            .export(kittycad_modeling_cmds::format::OutputFormat3d::Step(
                kittycad_modeling_cmds::format::step::export::Options {
                    coords: *kittycad_modeling_cmds::coord::KITTYCAD,
                    created: if deterministic_time {
                        Some("2021-01-01T00:00:00Z".parse().map_err(|e| {
                            KclError::Internal(crate::errors::KclErrorDetails {
                                message: format!("Failed to parse date: {}", e),
                                source_ranges: vec![SourceRange::default()],
                            })
                        })?)
                    } else {
                        None
                    },
                },
            ))
            .await?;

        Ok(files)
    }

    pub async fn close(&self) {
        self.engine.close().await;
    }
}

#[cfg(test)]
pub(crate) async fn parse_execute(code: &str) -> Result<ExecTestResults, KclError> {
    let program = crate::Program::parse_no_errs(code)?;

    let exec_ctxt = ExecutorContext {
        engine: Arc::new(Box::new(
            crate::engine::conn_mock::EngineConnection::new().await.map_err(|err| {
                KclError::Internal(crate::errors::KclErrorDetails {
                    message: format!("Failed to create mock engine connection: {}", err),
                    source_ranges: vec![SourceRange::default()],
                })
            })?,
        )),
        fs: Arc::new(crate::fs::FileManager::new()),
        stdlib: Arc::new(crate::std::StdLib::new()),
        settings: Default::default(),
        context_type: ContextType::Mock,
    };
    let mut exec_state = ExecState::new(&exec_ctxt);
    let result = exec_ctxt.run(&program, &mut exec_state).await?;

    Ok(ExecTestResults {
        program,
        mem_env: result.0,
        exec_ctxt,
        exec_state,
    })
}

#[cfg(test)]
#[derive(Debug)]
pub(crate) struct ExecTestResults {
    program: crate::Program,
    mem_env: EnvironmentRef,
    exec_ctxt: ExecutorContext,
    exec_state: ExecState,
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::{errors::KclErrorDetails, execution::memory::Stack, ModuleId};

    /// Convenience function to get a JSON value from memory and unwrap.
    #[track_caller]
    fn mem_get_json(memory: &Stack, env: EnvironmentRef, name: &str) -> KclValue {
        memory.memory.get_from_unchecked(name, env).unwrap().to_owned()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_warn() {
        let text = "@blah";
        let result = parse_execute(text).await.unwrap();
        let errs = result.exec_state.errors();
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].severity, crate::errors::Severity::Warning);
        assert!(
            errs[0].message.contains("Unknown annotation"),
            "unexpected warning message: {}",
            errs[0].message
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_warn_on_deprecated() {
        let text = "p = pi()";
        let result = parse_execute(text).await.unwrap();
        let errs = result.exec_state.errors();
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].severity, crate::errors::Severity::Warning);
        assert!(
            errs[0].message.contains("`pi` is deprecated"),
            "unexpected warning message: {}",
            errs[0].message
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_fn_definitions() {
        let ast = r#"fn def = (x) => {
  return x
}
fn ghi = (x) => {
  return x
}
fn jkl = (x) => {
  return x
}
fn hmm = (x) => {
  return x
}

yo = 5 + 6

abc = 3
identifierGuy = 5
part001 = startSketchOn(XY)
|> startProfileAt([-1.2, 4.83], %)
|> line(end = [2.8, 0])
|> angledLine([100 + 100, 3.01], %)
|> angledLine([abc, 3.02], %)
|> angledLine([def(yo), 3.03], %)
|> angledLine([ghi(2), 3.04], %)
|> angledLine([jkl(yo) + 2, 3.05], %)
|> close()
yo2 = hmm([identifierGuy + 5])"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_pipe_substitutions_unary() {
        let ast = r#"const myVar = 3
const part001 = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [3, 4], tag = $seg01)
  |> line(end = [
  min(segLen(seg01), myVar),
  -legLen(segLen(seg01), myVar)
])
"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_pipe_substitutions() {
        let ast = r#"const myVar = 3
const part001 = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [3, 4], tag = $seg01)
  |> line(end = [
  min(segLen(seg01), myVar),
  legLen(segLen(seg01), myVar)
])
"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_inline_comment() {
        let ast = r#"const baseThick = 1
const armAngle = 60

const baseThickHalf = baseThick / 2
const halfArmAngle = armAngle / 2

const arrExpShouldNotBeIncluded = [1, 2, 3]
const objExpShouldNotBeIncluded = { a: 1, b: 2, c: 3 }

const part001 = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> yLine(endAbsolute = 1)
  |> xLine(length = 3.84) // selection-range-7ish-before-this

const variableBelowShouldNotBeIncluded = 3
"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_literal_in_pipe() {
        let ast = r#"const w = 20
const l = 8
const h = 10

fn thing = () => {
  return -8
}

const firstExtrude = startSketchOn(XY)
  |> startProfileAt([0,0], %)
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, thing()])
  |> close()
  |> extrude(length = h)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_unary_in_pipe() {
        let ast = r#"const w = 20
const l = 8
const h = 10

fn thing = (x) => {
  return -x
}

const firstExtrude = startSketchOn(XY)
  |> startProfileAt([0,0], %)
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, thing(8)])
  |> close()
  |> extrude(length = h)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_array_in_pipe() {
        let ast = r#"const w = 20
const l = 8
const h = 10

fn thing = (x) => {
  return [0, -x]
}

const firstExtrude = startSketchOn(XY)
  |> startProfileAt([0,0], %)
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = thing(8))
  |> close()
  |> extrude(length = h)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_call_in_pipe() {
        let ast = r#"const w = 20
const l = 8
const h = 10

fn other_thing = (y) => {
  return -y
}

fn thing = (x) => {
  return other_thing(x)
}

const firstExtrude = startSketchOn(XY)
  |> startProfileAt([0,0], %)
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, thing(8)])
  |> close()
  |> extrude(length = h)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_sketch() {
        let ast = r#"fn box = (h, l, w) => {
 const myBox = startSketchOn(XY)
    |> startProfileAt([0,0], %)
    |> line(end = [0, l])
    |> line(end = [w, 0])
    |> line(end = [0, -l])
    |> close()
    |> extrude(length = h)

  return myBox
}

const fnBox = box(3, 6, 10)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_object_with_function_period() {
        let ast = r#"fn box = (obj) => {
 let myBox = startSketchOn(XY)
    |> startProfileAt(obj.start, %)
    |> line(end = [0, obj.l])
    |> line(end = [obj.w, 0])
    |> line(end = [0, -obj.l])
    |> close()
    |> extrude(length = obj.h)

  return myBox
}

const thisBox = box({start: [0,0], l: 6, w: 10, h: 3})
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_object_with_function_brace() {
        let ast = r#"fn box = (obj) => {
 let myBox = startSketchOn(XY)
    |> startProfileAt(obj["start"], %)
    |> line(end = [0, obj["l"]])
    |> line(end = [obj["w"], 0])
    |> line(end = [0, -obj["l"]])
    |> close()
    |> extrude(length = obj["h"])

  return myBox
}

const thisBox = box({start: [0,0], l: 6, w: 10, h: 3})
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_object_with_function_mix_period_brace() {
        let ast = r#"fn box = (obj) => {
 let myBox = startSketchOn(XY)
    |> startProfileAt(obj["start"], %)
    |> line(end = [0, obj["l"]])
    |> line(end = [obj["w"], 0])
    |> line(end = [10 - obj["w"], -obj.l])
    |> close()
    |> extrude(length = obj["h"])

  return myBox
}

const thisBox = box({start: [0,0], l: 6, w: 10, h: 3})
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // https://github.com/KittyCAD/modeling-app/issues/3338
    async fn test_object_member_starting_pipeline() {
        let ast = r#"
fn test2 = () => {
  return {
    thing: startSketchOn(XY)
      |> startProfileAt([0, 0], %)
      |> line(end = [0, 1])
      |> line(end = [1, 0])
      |> line(end = [0, -1])
      |> close()
  }
}

const x2 = test2()

x2.thing
  |> extrude(length = 10)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // ignore til we get loops
    async fn test_execute_with_function_sketch_loop_objects() {
        let ast = r#"fn box = (obj) => {
let myBox = startSketchOn(XY)
    |> startProfileAt(obj.start, %)
    |> line(end = [0, obj.l])
    |> line(end = [obj.w, 0])
    |> line(end = [0, -obj.l])
    |> close()
    |> extrude(length = obj.h)

  return myBox
}

for var in [{start: [0,0], l: 6, w: 10, h: 3}, {start: [-10,-10], l: 3, w: 5, h: 1.5}] {
  const thisBox = box(var)
}"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // ignore til we get loops
    async fn test_execute_with_function_sketch_loop_array() {
        let ast = r#"fn box = (h, l, w, start) => {
 const myBox = startSketchOn(XY)
    |> startProfileAt([0,0], %)
    |> line(end = [0, l])
    |> line(end = [w, 0])
    |> line(end = [0, -l])
    |> close()
    |> extrude(length = h)

  return myBox
}


for var in [[3, 6, 10, [0,0]], [1.5, 3, 5, [-10,-10]]] {
  const thisBox = box(var[0], var[1], var[2], var[3])
}"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_array_with_function() {
        let ast = r#"fn box = (arr) => {
 let myBox =startSketchOn(XY)
    |> startProfileAt(arr[0], %)
    |> line(end = [0, arr[1]])
    |> line(end = [arr[2], 0])
    |> line(end = [0, -arr[1]])
    |> close()
    |> extrude(length = arr[3])

  return myBox
}

const thisBox = box([[0,0], 6, 10, 3])

"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_function_cannot_access_future_definitions() {
        let ast = r#"
fn returnX = () => {
  // x shouldn't be defined yet.
  return x
}

const x = 5

const answer = returnX()"#;

        let result = parse_execute(ast).await;
        let err = result.unwrap_err();
        assert_eq!(
            err,
            KclError::UndefinedValue(KclErrorDetails {
                message: "memory item key `x` is not defined".to_owned(),
                source_ranges: vec![
                    SourceRange::new(64, 65, ModuleId::default()),
                    SourceRange::new(97, 106, ModuleId::default())
                ],
            }),
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_override_prelude() {
        let text = "PI = 3.0";
        let result = parse_execute(text).await.unwrap();
        let errs = result.exec_state.errors();
        assert!(errs.is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn type_aliases() {
        let text = r#"type MyTy = [number; 2]
fn foo(x: MyTy) {
    return x[0]
}

foo([0, 1])

type Other = MyTy | Helix
"#;
        let result = parse_execute(text).await.unwrap();
        let errs = result.exec_state.errors();
        assert!(errs.is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_cannot_shebang_in_fn() {
        let ast = r#"
fn foo () {
  #!hello
  return true
}

foo
"#;

        let result = parse_execute(ast).await;
        let err = result.unwrap_err();
        assert_eq!(
            err,
            KclError::Syntax(KclErrorDetails {
                message: "Unexpected token: #".to_owned(),
                source_ranges: vec![SourceRange::new(15, 16, ModuleId::default())],
            }),
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_pattern_transform_function_cannot_access_future_definitions() {
        let ast = r#"
fn transform = (replicaId) => {
  // x shouldn't be defined yet.
  let scale = x
  return {
    translate: [0, 0, replicaId * 10],
    scale: [scale, 1, 0],
  }
}

fn layer = () => {
  return startSketchOn(XY)
    |> circle( center= [0, 0], radius= 1 , tag =$tag1)
    |> extrude(length = 10)
}

const x = 5

// The 10 layers are replicas of each other, with a transform applied to each.
let shape = layer() |> patternTransform(instances = 10, transform = transform)
"#;

        let result = parse_execute(ast).await;
        let err = result.unwrap_err();
        assert_eq!(
            err,
            KclError::UndefinedValue(KclErrorDetails {
                message: "memory item key `x` is not defined".to_owned(),
                source_ranges: vec![SourceRange::new(80, 81, ModuleId::default())],
            }),
        );
    }

    // ADAM: Move some of these into simulation tests.

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_with_functions() {
        let ast = r#"const myVar = 2 + min(100, -1 + legLen(5, 3))"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            5.0,
            mem_get_json(result.exec_state.stack(), result.mem_env, "myVar")
                .as_f64()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute() {
        let ast = r#"const myVar = 1 + 2 * (3 - 4) / -5 + 6"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            7.4,
            mem_get_json(result.exec_state.stack(), result.mem_env, "myVar")
                .as_f64()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_start_negative() {
        let ast = r#"const myVar = -5 + 6"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            1.0,
            mem_get_json(result.exec_state.stack(), result.mem_env, "myVar")
                .as_f64()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_with_pi() {
        let ast = r#"const myVar = PI * 2"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            std::f64::consts::TAU,
            mem_get_json(result.exec_state.stack(), result.mem_env, "myVar")
                .as_f64()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_define_decimal_without_leading_zero() {
        let ast = r#"let thing = .4 + 7"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            7.4,
            mem_get_json(result.exec_state.stack(), result.mem_env, "thing")
                .as_f64()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unit_default() {
        let ast = r#"const inMm = 25.4 * mm()
const inInches = 1.0 * inch()"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            25.4,
            mem_get_json(result.exec_state.stack(), result.mem_env, "inMm")
                .as_f64()
                .unwrap()
        );
        assert_eq!(
            25.4,
            mem_get_json(result.exec_state.stack(), result.mem_env, "inInches")
                .as_f64()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unit_overriden() {
        let ast = r#"@settings(defaultLengthUnit = inch)
const inMm = 25.4 * mm()
const inInches = 1.0 * inch()"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            1.0,
            mem_get_json(result.exec_state.stack(), result.mem_env, "inMm")
                .as_f64()
                .unwrap()
                .round()
        );
        assert_eq!(
            1.0,
            mem_get_json(result.exec_state.stack(), result.mem_env, "inInches")
                .as_f64()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unit_overriden_in() {
        let ast = r#"@settings(defaultLengthUnit = in)
const inMm = 25.4 * mm()
const inInches = 2.0 * inch()"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            1.0,
            mem_get_json(result.exec_state.stack(), result.mem_env, "inMm")
                .as_f64()
                .unwrap()
                .round()
        );
        assert_eq!(
            2.0,
            mem_get_json(result.exec_state.stack(), result.mem_env, "inInches")
                .as_f64()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_zero_param_fn() {
        let ast = r#"const sigmaAllow = 35000 // psi
const leg1 = 5 // inches
const leg2 = 8 // inches
fn thickness = () => { return 0.56 }

const bracket = startSketchOn(XY)
  |> startProfileAt([0,0], %)
  |> line(end = [0, leg1])
  |> line(end = [leg2, 0])
  |> line(end = [0, -thickness()])
  |> line(end = [-leg2 + thickness(), 0])
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_bad_arg_count_std() {
        let ast = "startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> profileStartX()";
        assert!(parse_execute(ast)
            .await
            .unwrap_err()
            .message()
            .contains("Expected a sketch argument"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unary_operator_not_succeeds() {
        let ast = r#"
fn returnTrue = () => { return !false }
const t = true
const f = false
let notTrue = !t
let notFalse = !f
let c = !!true
let d = !returnTrue()

assert(!false, "expected to pass")

fn check = (x) => {
  assert(!x, "expected argument to be false")
  return true
}
check(false)
"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            false,
            mem_get_json(result.exec_state.stack(), result.mem_env, "notTrue")
                .as_bool()
                .unwrap()
        );
        assert_eq!(
            true,
            mem_get_json(result.exec_state.stack(), result.mem_env, "notFalse")
                .as_bool()
                .unwrap()
        );
        assert_eq!(
            true,
            mem_get_json(result.exec_state.stack(), result.mem_env, "c")
                .as_bool()
                .unwrap()
        );
        assert_eq!(
            false,
            mem_get_json(result.exec_state.stack(), result.mem_env, "d")
                .as_bool()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unary_operator_not_on_non_bool_fails() {
        let code1 = r#"
// Yup, this is null.
let myNull = 0 / 0
let notNull = !myNull
"#;
        assert_eq!(
            parse_execute(code1).await.unwrap_err(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: number".to_owned(),
                source_ranges: vec![SourceRange::new(56, 63, ModuleId::default())],
            })
        );

        let code2 = "let notZero = !0";
        assert_eq!(
            parse_execute(code2).await.unwrap_err(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: number".to_owned(),
                source_ranges: vec![SourceRange::new(14, 16, ModuleId::default())],
            })
        );

        let code3 = r#"
let notEmptyString = !""
"#;
        assert_eq!(
            parse_execute(code3).await.unwrap_err(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: string (text)".to_owned(),
                source_ranges: vec![SourceRange::new(22, 25, ModuleId::default())],
            })
        );

        let code4 = r#"
let obj = { a: 1 }
let notMember = !obj.a
"#;
        assert_eq!(
            parse_execute(code4).await.unwrap_err(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: number".to_owned(),
                source_ranges: vec![SourceRange::new(36, 42, ModuleId::default())],
            })
        );

        let code5 = "
let a = []
let notArray = !a";
        assert_eq!(
            parse_execute(code5).await.unwrap_err(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: array (list)".to_owned(),
                source_ranges: vec![SourceRange::new(27, 29, ModuleId::default())],
            })
        );

        let code6 = "
let x = {}
let notObject = !x";
        assert_eq!(
            parse_execute(code6).await.unwrap_err(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: object".to_owned(),
                source_ranges: vec![SourceRange::new(28, 30, ModuleId::default())],
            })
        );

        let code7 = "
fn x = () => { return 1 }
let notFunction = !x";
        let fn_err = parse_execute(code7).await.unwrap_err();
        // These are currently printed out as JSON objects, so we don't want to
        // check the full error.
        assert!(
            fn_err
                .message()
                .starts_with("Cannot apply unary operator ! to non-boolean value: "),
            "Actual error: {:?}",
            fn_err
        );

        let code8 = "
let myTagDeclarator = $myTag
let notTagDeclarator = !myTagDeclarator";
        let tag_declarator_err = parse_execute(code8).await.unwrap_err();
        // These are currently printed out as JSON objects, so we don't want to
        // check the full error.
        assert!(
            tag_declarator_err
                .message()
                .starts_with("Cannot apply unary operator ! to non-boolean value: TagDeclarator"),
            "Actual error: {:?}",
            tag_declarator_err
        );

        let code9 = "
let myTagDeclarator = $myTag
let notTagIdentifier = !myTag";
        let tag_identifier_err = parse_execute(code9).await.unwrap_err();
        // These are currently printed out as JSON objects, so we don't want to
        // check the full error.
        assert!(
            tag_identifier_err
                .message()
                .starts_with("Cannot apply unary operator ! to non-boolean value: TagIdentifier"),
            "Actual error: {:?}",
            tag_identifier_err
        );

        let code10 = "let notPipe = !(1 |> 2)";
        assert_eq!(
            // TODO: We don't currently parse this, but we should.  It should be
            // a runtime error instead.
            parse_execute(code10).await.unwrap_err(),
            KclError::Syntax(KclErrorDetails {
                message: "Unexpected token: !".to_owned(),
                source_ranges: vec![SourceRange::new(14, 15, ModuleId::default())],
            })
        );

        let code11 = "
fn identity = (x) => { return x }
let notPipeSub = 1 |> identity(!%))";
        assert_eq!(
            // TODO: We don't currently parse this, but we should.  It should be
            // a runtime error instead.
            parse_execute(code11).await.unwrap_err(),
            KclError::Syntax(KclErrorDetails {
                message: "Unexpected token: |>".to_owned(),
                source_ranges: vec![SourceRange::new(54, 56, ModuleId::default())],
            })
        );

        // TODO: Add these tests when we support these types.
        // let notNan = !NaN
        // let notInfinity = !Infinity
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_negative_variable_in_binary_expression() {
        let ast = r#"const sigmaAllow = 35000 // psi
const width = 1 // inch

const p = 150 // lbs
const distance = 6 // inches
const FOS = 2

const leg1 = 5 // inches
const leg2 = 8 // inches

const thickness_squared = distance * p * FOS * 6 / sigmaAllow
const thickness = 0.56 // inches. App does not support square root function yet

const bracket = startSketchOn(XY)
  |> startProfileAt([0,0], %)
  |> line(end = [0, leg1])
  |> line(end = [leg2, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-leg2 + thickness, 0])
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_function_no_return() {
        let ast = r#"fn test = (origin) => {
  origin
}

test([0, 0])
"#;
        let result = parse_execute(ast).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("undefined"),);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_doubly_nested_parens() {
        let ast = r#"const sigmaAllow = 35000 // psi
const width = 4 // inch
const p = 150 // Force on shelf - lbs
const distance = 6 // inches
const FOS = 2
const leg1 = 5 // inches
const leg2 = 8 // inches
const thickness_squared = (distance * p * FOS * 6 / (sigmaAllow - width))
const thickness = 0.32 // inches. App does not support square root function yet
const bracket = startSketchOn(XY)
  |> startProfileAt([0,0], %)
    |> line(end = [0, leg1])
  |> line(end = [leg2, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-1 * leg2 + thickness, 0])
  |> line(end = [0, -1 * leg1 + thickness])
  |> close()
  |> extrude(length = width)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_nested_parens_one_less() {
        let ast = r#"const sigmaAllow = 35000 // psi
const width = 4 // inch
const p = 150 // Force on shelf - lbs
const distance = 6 // inches
const FOS = 2
const leg1 = 5 // inches
const leg2 = 8 // inches
const thickness_squared = distance * p * FOS * 6 / (sigmaAllow - width)
const thickness = 0.32 // inches. App does not support square root function yet
const bracket = startSketchOn(XY)
  |> startProfileAt([0,0], %)
    |> line(end = [0, leg1])
  |> line(end = [leg2, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-1 * leg2 + thickness, 0])
  |> line(end = [0, -1 * leg1 + thickness])
  |> close()
  |> extrude(length = width)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_fn_as_operand() {
        let ast = r#"fn f = () => { return 1 }
let x = f()
let y = x + 1
let z = f() + 1
let w = f() + f()
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_ids_stable_between_executions() {
        let code = r#"sketch001 = startSketchOn(XZ)
|> startProfileAt([61.74, 206.13], %)
|> xLine(length = 305.11, tag = $seg01)
|> yLine(length = -291.85)
|> xLine(length = -segLen(seg01))
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
|> extrude(length = 40.14)
|> shell(
    thickness = 3.14,
    faces = [seg01]
)
"#;

        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let old_program = crate::Program::parse_no_errs(code).unwrap();

        // Execute the program.
        if let Err(err) = ctx.run_with_caching(old_program).await {
            let report = err.into_miette_report_with_outputs(code).unwrap();
            let report = miette::Report::new(report);
            panic!("Error executing program: {:?}", report);
        }

        // Get the id_generator from the first execution.
        let id_generator = cache::read_old_ast().await.unwrap().exec_state.mod_local.id_generator;

        let code = r#"sketch001 = startSketchOn(XZ)
|> startProfileAt([62.74, 206.13], %)
|> xLine(length = 305.11, tag = $seg01)
|> yLine(length = -291.85)
|> xLine(length = -segLen(seg01))
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
|> extrude(length = 40.14)
|> shell(
    faces = [seg01],
    thickness = 3.14,
)
"#;

        // Execute a slightly different program again.
        let program = crate::Program::parse_no_errs(code).unwrap();
        // Execute the program.
        ctx.run_with_caching(program).await.unwrap();

        let new_id_generator = cache::read_old_ast().await.unwrap().exec_state.mod_local.id_generator;

        assert_eq!(id_generator, new_id_generator);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_changing_a_setting_updates_the_cached_state() {
        let code = r#"sketch001 = startSketchOn('XZ')
|> startProfileAt([61.74, 206.13], %)
|> xLine(length = 305.11, tag = $seg01)
|> yLine(length = -291.85)
|> xLine(length = -segLen(seg01))
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
|> extrude(length = 40.14)
|> shell(
    thickness = 3.14,
    faces = [seg01]
)
"#;

        let mut ctx = crate::test_server::new_context(true, None).await.unwrap();
        let old_program = crate::Program::parse_no_errs(code).unwrap();

        // Execute the program.
        ctx.run_with_caching(old_program.clone()).await.unwrap();

        let settings_state = cache::read_old_ast().await.unwrap().settings;

        // Ensure the settings are as expected.
        assert_eq!(settings_state, ctx.settings);

        // Change a setting.
        ctx.settings.highlight_edges = !ctx.settings.highlight_edges;

        // Execute the program.
        ctx.run_with_caching(old_program.clone()).await.unwrap();

        let settings_state = cache::read_old_ast().await.unwrap().settings;

        // Ensure the settings are as expected.
        assert_eq!(settings_state, ctx.settings);

        // Change a setting.
        ctx.settings.highlight_edges = !ctx.settings.highlight_edges;

        // Execute the program.
        ctx.run_with_caching(old_program).await.unwrap();

        let settings_state = cache::read_old_ast().await.unwrap().settings;

        // Ensure the settings are as expected.
        assert_eq!(settings_state, ctx.settings);

        ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn mock_after_not_mock() {
        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let program = crate::Program::parse_no_errs("x = 2").unwrap();
        let result = ctx.run_with_caching(program).await.unwrap();
        assert_eq!(result.variables.get("x").unwrap().as_f64().unwrap(), 2.0);

        let ctx2 = ExecutorContext::new_mock().await;
        let program2 = crate::Program::parse_no_errs("z = x + 1").unwrap();
        let result = ctx2.run_mock(program2, true).await.unwrap();
        assert_eq!(result.variables.get("z").unwrap().as_f64().unwrap(), 3.0);

        ctx.close().await;
        ctx2.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn read_tag_version() {
        let ast = r#"fn bar(t) {
  return startSketchOn(XY)
    |> startProfileAt([0,0], %)
    |> angledLine({
        angle = -60,
        length = segLen(t),
    }, %)
    |> line(end = [0, 0])
    |> close()
}
  
sketch = startSketchOn(XY)
  |> startProfileAt([0,0], %)
  |> line(end = [0, 10])
  |> line(end = [10, 0], tag = $tag0)
  |> line(end = [0, 0])

fn foo() {
  // tag0 tags an edge
  return bar(tag0)
}

solid = sketch |> extrude(length = 10)
// tag0 tags a face
sketch2 = startSketchOn(solid, tag0)
  |> startProfileAt([0,0], %)
  |> line(end = [0, 1])
  |> line(end = [1, 0])
  |> line(end = [0, 0])

foo() |> extrude(length = 1)
"#;
        parse_execute(ast).await.unwrap();
    }
}
