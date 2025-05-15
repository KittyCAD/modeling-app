//! The executor for the AST.

use std::sync::Arc;

use anyhow::Result;
#[cfg(feature = "artifact-graph")]
pub use artifact::{
    Artifact, ArtifactCommand, ArtifactGraph, ArtifactId, CodeRef, StartSketchOnFace, StartSketchOnPlane,
};
use cache::OldAstState;
pub use cache::{bust_cache, clear_mem_cache};
#[cfg(feature = "artifact-graph")]
pub use cad_op::{Group, Operation};
pub use geometry::*;
pub use id_generator::IdGenerator;
pub(crate) use import::PreImportedGeometry;
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

#[cfg(feature = "artifact-graph")]
use crate::execution::artifact::build_artifact_graph;
use crate::{
    engine::EngineManager,
    errors::{KclError, KclErrorDetails},
    execution::{
        cache::{CacheInformation, CacheResult},
        typed_path::TypedPath,
        types::{UnitAngle, UnitLen},
    },
    fs::FileManager,
    modules::{ModuleId, ModulePath, ModuleRepr},
    parsing::ast::types::{Expr, ImportPath, NodeRef},
    source_range::SourceRange,
    std::StdLib,
    walk::{Universe, UniverseMap},
    CompilationError, ExecError, KclErrorWithOutputs,
};

pub(crate) mod annotations;
#[cfg(feature = "artifact-graph")]
mod artifact;
pub(crate) mod cache;
#[cfg(feature = "artifact-graph")]
mod cad_op;
mod exec_ast;
mod geometry;
mod id_generator;
mod import;
pub(crate) mod kcl_value;
mod memory;
mod state;
pub mod typed_path;
pub(crate) mod types;

/// Outcome of executing a program.  This is used in TS.
#[derive(Debug, Clone, Serialize, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutcome {
    /// Variables in the top-level of the root module. Note that functions will have an invalid env ref.
    pub variables: IndexMap<String, KclValue>,
    /// Operations that have been performed in execution order, for display in
    /// the Feature Tree.
    #[cfg(feature = "artifact-graph")]
    pub operations: Vec<Operation>,
    /// Output commands to allow building the artifact graph by the caller.
    #[cfg(feature = "artifact-graph")]
    pub artifact_commands: Vec<ArtifactCommand>,
    /// Output artifact graph.
    #[cfg(feature = "artifact-graph")]
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
    // was written.
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
        for (oe, ot) in &other.info {
            if let Some((e, t)) = self.info.last_mut() {
                // If there is newer info, then skip this iteration.
                if *e > *oe {
                    continue;
                }
                // If we're in the same epoch, then overwrite.
                if e == oe {
                    *t = ot.clone();
                    continue;
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
    /// Mock mode is only for the Design Studio when they just want to mock engine calls and not
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
    pub project_directory: Option<TypedPath>,
    /// This is the path to the current file being executed.
    /// We use this for preventing cyclic imports.
    pub current_file: Option<TypedPath>,
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
    pub fn with_current_file(&mut self, current_file: TypedPath) {
        // We want the parent directory of the file.
        if current_file.extension() == Some("kcl") {
            self.current_file = Some(current_file.clone());
            // Get the parent directory.
            if let Some(parent) = current_file.parent() {
                self.project_directory = Some(parent);
            } else {
                self.project_directory = Some(TypedPath::from(""));
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
    pub async fn new_mock(settings: Option<ExecutorSettings>) -> Self {
        ExecutorContext {
            engine: Arc::new(Box::new(
                crate::engine::conn_mock::EngineConnection::new().await.unwrap(),
            )),
            fs: Arc::new(FileManager::new()),
            stdlib: Arc::new(StdLib::new()),
            settings: settings.unwrap_or_default(),
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
        self.is_mock()
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
        let outcome = exec_state.to_mock_exec_outcome(result.0).await;

        mem.squash_env(result.0);
        cache::write_old_memory((mem, module_infos)).await;

        Ok(outcome)
    }

    pub async fn run_with_caching(&self, program: crate::Program) -> Result<ExecOutcome, KclErrorWithOutputs> {
        assert!(!self.is_mock());

        let (program, mut exec_state, preserve_mem, imports_info) = if let Some(OldAstState {
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
            let (clear_scene, program, import_check_info) = match cache::get_changed_program(old, new).await {
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
                        (true, program, None)
                    } else {
                        (
                            clear_scene,
                            crate::Program {
                                ast: changed_program,
                                original_file_contents: program.original_file_contents,
                            },
                            None,
                        )
                    }
                }
                CacheResult::CheckImportsOnly {
                    reapply_settings,
                    ast: changed_program,
                } => {
                    if reapply_settings
                        && self
                            .engine
                            .reapply_settings(&self.settings, Default::default(), old_state.id_generator())
                            .await
                            .is_err()
                    {
                        (true, program, None)
                    } else {
                        // We need to check our imports to see if they changed.
                        let mut new_exec_state = ExecState::new(self);
                        let (new_universe, new_universe_map) = self.get_universe(&program, &mut new_exec_state).await?;
                        let mut clear_scene = false;

                        let mut keys = new_universe.keys().clone().collect::<Vec<_>>();
                        keys.sort();
                        for key in keys {
                            let (_, id, _, _) = &new_universe[key];
                            if let (Some(source0), Some(source1)) =
                                (old_state.get_source(*id), new_exec_state.get_source(*id))
                            {
                                if source0.source != source1.source {
                                    clear_scene = true;
                                    break;
                                }
                            }
                        }

                        if !clear_scene {
                            // Return early we don't need to clear the scene.
                            let outcome = old_state.to_exec_outcome(result_env).await;
                            return Ok(outcome);
                        }

                        (
                            clear_scene,
                            crate::Program {
                                ast: changed_program,
                                original_file_contents: program.original_file_contents,
                            },
                            // We only care about this if we are clearing the scene.
                            if clear_scene {
                                Some((new_universe, new_universe_map, new_exec_state))
                            } else {
                                None
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

                        let outcome = old_state.to_exec_outcome(result_env).await;
                        return Ok(outcome);
                    }
                    (true, program, None)
                }
                CacheResult::NoAction(false) => {
                    let outcome = old_state.to_exec_outcome(result_env).await;
                    return Ok(outcome);
                }
            };

            let (exec_state, preserve_mem, universe_info) =
                if let Some((new_universe, new_universe_map, mut new_exec_state)) = import_check_info {
                    // Clear the scene if the imports changed.
                    self.send_clear_scene(&mut new_exec_state, Default::default())
                        .await
                        .map_err(KclErrorWithOutputs::no_outputs)?;

                    (new_exec_state, false, Some((new_universe, new_universe_map)))
                } else if clear_scene {
                    // Pop the execution state, since we are starting fresh.
                    let mut exec_state = old_state;
                    exec_state.reset(self);

                    self.send_clear_scene(&mut exec_state, Default::default())
                        .await
                        .map_err(KclErrorWithOutputs::no_outputs)?;

                    (exec_state, false, None)
                } else {
                    old_state.mut_stack().restore_env(result_env);

                    (old_state, true, None)
                };

            (program, exec_state, preserve_mem, universe_info)
        } else {
            let mut exec_state = ExecState::new(self);
            self.send_clear_scene(&mut exec_state, Default::default())
                .await
                .map_err(KclErrorWithOutputs::no_outputs)?;
            (program, exec_state, false, None)
        };

        let result = self
            .run_concurrent(&program, &mut exec_state, imports_info, preserve_mem)
            .await;

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

        let outcome = exec_state.to_exec_outcome(result.0).await;
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
        self.run_concurrent(program, exec_state, None, false).await
    }

    /// Perform the execution of a program using a concurrent
    /// execution model. This has the same signature as [Self::run].
    ///
    /// You can optionally pass in some initialization memory for partial
    /// execution.
    ///
    /// To access non-fatal errors and warnings, extract them from the `ExecState`.
    pub async fn run_concurrent(
        &self,
        program: &crate::Program,
        exec_state: &mut ExecState,
        universe_info: Option<(Universe, UniverseMap)>,
        preserve_mem: bool,
    ) -> Result<(EnvironmentRef, Option<ModelingSessionData>), KclErrorWithOutputs> {
        // Reuse our cached universe if we have one.
        #[allow(unused_variables)]
        let (universe, universe_map) = if let Some((universe, universe_map)) = universe_info {
            (universe, universe_map)
        } else {
            self.get_universe(program, exec_state).await?
        };

        let default_planes = self.engine.get_default_planes().read().await.clone();

        // Run the prelude to set up the engine.
        self.eval_prelude(exec_state, SourceRange::synthetic())
            .await
            .map_err(KclErrorWithOutputs::no_outputs)?;

        for modules in crate::walk::import_graph(&universe, self)
            .map_err(|err| {
                let module_id_to_module_path: IndexMap<ModuleId, ModulePath> = exec_state
                    .global
                    .path_to_source_id
                    .iter()
                    .map(|(k, v)| ((*v), k.clone()))
                    .collect();

                KclErrorWithOutputs::new(
                    err,
                    #[cfg(feature = "artifact-graph")]
                    exec_state.global.operations.clone(),
                    #[cfg(feature = "artifact-graph")]
                    exec_state.global.artifact_commands.clone(),
                    #[cfg(feature = "artifact-graph")]
                    exec_state.global.artifact_graph.clone(),
                    module_id_to_module_path,
                    exec_state.global.id_to_source.clone(),
                    default_planes.clone(),
                )
            })?
            .into_iter()
        {
            #[cfg(not(target_arch = "wasm32"))]
            let mut set = tokio::task::JoinSet::new();

            #[allow(clippy::type_complexity)]
            let (results_tx, mut results_rx): (
                tokio::sync::mpsc::Sender<(ModuleId, ModulePath, Result<ModuleRepr, KclError>)>,
                tokio::sync::mpsc::Receiver<_>,
            ) = tokio::sync::mpsc::channel(1);

            for module in modules {
                let Some((import_stmt, module_id, module_path, repr)) = universe.get(&module) else {
                    return Err(KclErrorWithOutputs::no_outputs(KclError::Internal(KclErrorDetails {
                        message: format!("Module {module} not found in universe"),
                        source_ranges: Default::default(),
                    })));
                };
                let module_id = *module_id;
                let module_path = module_path.clone();
                let source_range = SourceRange::from(import_stmt);

                #[cfg(feature = "artifact-graph")]
                match &module_path {
                    ModulePath::Main => {
                        // This should never happen.
                    }
                    ModulePath::Local { value, .. } => {
                        // We only want to display the top-level module imports in
                        // the Feature Tree, not transitive imports.
                        if universe_map.contains_key(value) {
                            exec_state.global.operations.push(Operation::GroupBegin {
                                group: Group::ModuleInstance {
                                    name: value.file_name().unwrap_or_default(),
                                    module_id,
                                },
                                source_range,
                            });
                            // Due to concurrent execution, we cannot easily
                            // group operations by module. So we leave the
                            // group empty and close it immediately.
                            exec_state.global.operations.push(Operation::GroupEnd);
                        }
                    }
                    ModulePath::Std { .. } => {
                        // We don't want to display stdlib in the Feature Tree.
                    }
                }

                let repr = repr.clone();
                let exec_state = exec_state.clone();
                let exec_ctxt = self.clone();
                let results_tx = results_tx.clone();

                let exec_module = async |exec_ctxt: &ExecutorContext,
                                         repr: &ModuleRepr,
                                         module_id: ModuleId,
                                         module_path: &ModulePath,
                                         exec_state: &mut ExecState,
                                         source_range: SourceRange|
                       -> Result<ModuleRepr, KclError> {
                    match repr {
                        ModuleRepr::Kcl(program, _) => {
                            let result = exec_ctxt
                                .exec_module_from_ast(program, module_id, module_path, exec_state, source_range, false)
                                .await;

                            result.map(|val| ModuleRepr::Kcl(program.clone(), Some(val)))
                        }
                        ModuleRepr::Foreign(geom, _) => {
                            let result = crate::execution::import::send_to_engine(geom.clone(), exec_ctxt)
                                .await
                                .map(|geom| Some(KclValue::ImportedGeometry(geom)));

                            result.map(|val| ModuleRepr::Foreign(geom.clone(), val))
                        }
                        ModuleRepr::Dummy | ModuleRepr::Root => Err(KclError::Internal(KclErrorDetails {
                            message: format!("Module {module_path} not found in universe"),
                            source_ranges: vec![source_range],
                        })),
                    }
                };

                #[cfg(target_arch = "wasm32")]
                {
                    wasm_bindgen_futures::spawn_local(async move {
                        //set.spawn(async move {
                        let mut exec_state = exec_state;
                        let exec_ctxt = exec_ctxt;

                        let result = exec_module(
                            &exec_ctxt,
                            &repr,
                            module_id,
                            &module_path,
                            &mut exec_state,
                            source_range,
                        )
                        .await;

                        results_tx
                            .send((module_id, module_path, result))
                            .await
                            .unwrap_or_default();
                    });
                }
                #[cfg(not(target_arch = "wasm32"))]
                {
                    set.spawn(async move {
                        let mut exec_state = exec_state;
                        let exec_ctxt = exec_ctxt;

                        let result = exec_module(
                            &exec_ctxt,
                            &repr,
                            module_id,
                            &module_path,
                            &mut exec_state,
                            source_range,
                        )
                        .await;

                        results_tx
                            .send((module_id, module_path, result))
                            .await
                            .unwrap_or_default();
                    });
                }
            }

            drop(results_tx);

            while let Some((module_id, _, result)) = results_rx.recv().await {
                match result {
                    Ok(new_repr) => {
                        let mut repr = exec_state.global.module_infos[&module_id].take_repr();

                        match &mut repr {
                            ModuleRepr::Kcl(_, cache) => {
                                let ModuleRepr::Kcl(_, session_data) = new_repr else {
                                    unreachable!();
                                };
                                *cache = session_data;
                            }
                            ModuleRepr::Foreign(_, cache) => {
                                let ModuleRepr::Foreign(_, session_data) = new_repr else {
                                    unreachable!();
                                };
                                *cache = session_data;
                            }
                            ModuleRepr::Dummy | ModuleRepr::Root => unreachable!(),
                        }

                        exec_state.global.module_infos[&module_id].restore_repr(repr);
                    }
                    Err(e) => {
                        let module_id_to_module_path: IndexMap<ModuleId, ModulePath> = exec_state
                            .global
                            .path_to_source_id
                            .iter()
                            .map(|(k, v)| ((*v), k.clone()))
                            .collect();

                        return Err(KclErrorWithOutputs::new(
                            e,
                            #[cfg(feature = "artifact-graph")]
                            exec_state.global.operations.clone(),
                            #[cfg(feature = "artifact-graph")]
                            exec_state.global.artifact_commands.clone(),
                            #[cfg(feature = "artifact-graph")]
                            exec_state.global.artifact_graph.clone(),
                            module_id_to_module_path,
                            exec_state.global.id_to_source.clone(),
                            default_planes,
                        ));
                    }
                }
            }
        }

        self.inner_run(program, exec_state, preserve_mem).await
    }

    /// Get the universe & universe map of the program.
    /// And see if any of the imports changed.
    async fn get_universe(
        &self,
        program: &crate::Program,
        exec_state: &mut ExecState,
    ) -> Result<(Universe, UniverseMap), KclErrorWithOutputs> {
        exec_state.add_root_module_contents(program);

        let mut universe = std::collections::HashMap::new();

        let default_planes = self.engine.get_default_planes().read().await.clone();

        let root_imports = crate::walk::import_universe(
            self,
            &ModuleRepr::Kcl(program.ast.clone(), None),
            &mut universe,
            exec_state,
        )
        .await
        .map_err(|err| {
            println!("Error: {err:?}");
            let module_id_to_module_path: IndexMap<ModuleId, ModulePath> = exec_state
                .global
                .path_to_source_id
                .iter()
                .map(|(k, v)| ((*v), k.clone()))
                .collect();

            KclErrorWithOutputs::new(
                err,
                #[cfg(feature = "artifact-graph")]
                exec_state.global.operations.clone(),
                #[cfg(feature = "artifact-graph")]
                exec_state.global.artifact_commands.clone(),
                #[cfg(feature = "artifact-graph")]
                exec_state.global.artifact_graph.clone(),
                module_id_to_module_path,
                exec_state.global.id_to_source.clone(),
                default_planes,
            )
        })?;

        Ok((universe, root_imports))
    }

    /// Perform the execution of a program.  Accept all possible parameters and
    /// output everything.
    async fn inner_run(
        &self,
        program: &crate::Program,
        exec_state: &mut ExecState,
        preserve_mem: bool,
    ) -> Result<(EnvironmentRef, Option<ModelingSessionData>), KclErrorWithOutputs> {
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
                #[cfg(feature = "artifact-graph")]
                exec_state.global.operations.clone(),
                #[cfg(feature = "artifact-graph")]
                exec_state.global.artifact_commands.clone(),
                #[cfg(feature = "artifact-graph")]
                exec_state.global.artifact_graph.clone(),
                module_id_to_module_path,
                exec_state.global.id_to_source.clone(),
                default_planes.clone(),
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
                preserve_mem,
                ModuleId::default(),
                &ModulePath::Main,
            )
            .await;

        // Ensure all the async commands completed.
        self.engine.ensure_async_commands_completed().await?;

        // If we errored out and early-returned, there might be commands which haven't been executed
        // and should be dropped.
        self.engine.clear_queues().await;

        #[cfg(feature = "artifact-graph")]
        {
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
        #[cfg(not(feature = "artifact-graph"))]
        {
            exec_result.map(|(_, env_ref, _)| env_ref)
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
            let (module_memory, _) = self.exec_module_for_items(id, exec_state, source_range).await?;

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
    parse_execute_with_project_dir(code, None).await
}

#[cfg(test)]
pub(crate) async fn parse_execute_with_project_dir(
    code: &str,
    project_directory: Option<TypedPath>,
) -> Result<ExecTestResults, KclError> {
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
        settings: ExecutorSettings {
            project_directory,
            ..Default::default()
        },
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
    async fn test_execute_fn_definitions() {
        let ast = r#"fn def(@x) {
  return x
}
fn ghi(@x) {
  return x
}
fn jkl(@x) {
  return x
}
fn hmm(@x) {
  return x
}

yo = 5 + 6

abc = 3
identifierGuy = 5
part001 = startSketchOn(XY)
|> startProfile(at = [-1.2, 4.83])
|> line(end = [2.8, 0])
|> angledLine(angle = 100 + 100, length = 3.01)
|> angledLine(angle = abc, length = 3.02)
|> angledLine(angle = def(yo), length = 3.03)
|> angledLine(angle = ghi(2), length = 3.04)
|> angledLine(angle = jkl(yo) + 2, length = 3.05)
|> close()
yo2 = hmm([identifierGuy + 5])"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_pipe_substitutions_unary() {
        let ast = r#"myVar = 3
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [3, 4], tag = $seg01)
  |> line(end = [
  min([segLen(seg01), myVar]),
  -legLen(hypotenuse = segLen(seg01), leg = myVar)
])
"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_pipe_substitutions() {
        let ast = r#"myVar = 3
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [3, 4], tag = $seg01)
  |> line(end = [
  min([segLen(seg01), myVar]),
  legLen(hypotenuse = segLen(seg01), leg = myVar)
])
"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_inline_comment() {
        let ast = r#"baseThick = 1
armAngle = 60

baseThickHalf = baseThick / 2
halfArmAngle = armAngle / 2

arrExpShouldNotBeIncluded = [1, 2, 3]
objExpShouldNotBeIncluded = { a = 1, b = 2, c = 3 }

part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> yLine(endAbsolute = 1)
  |> xLine(length = 3.84) // selection-range-7ish-before-this

variableBelowShouldNotBeIncluded = 3
"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_literal_in_pipe() {
        let ast = r#"w = 20
l = 8
h = 10

fn thing() {
  return -8
}

firstExtrude = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, thing()])
  |> close()
  |> extrude(length = h)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_unary_in_pipe() {
        let ast = r#"w = 20
l = 8
h = 10

fn thing(@x) {
  return -x
}

firstExtrude = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, thing(8)])
  |> close()
  |> extrude(length = h)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_array_in_pipe() {
        let ast = r#"w = 20
l = 8
h = 10

fn thing(@x) {
  return [0, -x]
}

firstExtrude = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = thing(8))
  |> close()
  |> extrude(length = h)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_call_in_pipe() {
        let ast = r#"w = 20
l = 8
h = 10

fn other_thing(@y) {
  return -y
}

fn thing(@x) {
  return other_thing(x)
}

firstExtrude = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(end = [0, l])
  |> line(end = [w, 0])
  |> line(end = [0, thing(8)])
  |> close()
  |> extrude(length = h)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_sketch() {
        let ast = r#"fn box(h, l, w) {
 myBox = startSketchOn(XY)
    |> startProfile(at = [0,0])
    |> line(end = [0, l])
    |> line(end = [w, 0])
    |> line(end = [0, -l])
    |> close()
    |> extrude(length = h)

  return myBox
}

fnBox = box(h = 3, l = 6, w = 10)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_object_with_function_period() {
        let ast = r#"fn box(@obj) {
 myBox = startSketchOn(XY)
    |> startProfile(at = obj.start)
    |> line(end = [0, obj.l])
    |> line(end = [obj.w, 0])
    |> line(end = [0, -obj.l])
    |> close()
    |> extrude(length = obj.h)

  return myBox
}

thisBox = box({start = [0,0], l = 6, w = 10, h = 3})
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // https://github.com/KittyCAD/modeling-app/issues/3338
    async fn test_object_member_starting_pipeline() {
        let ast = r#"
fn test2() {
  return {
    thing: startSketchOn(XY)
      |> startProfile(at = [0, 0])
      |> line(end = [0, 1])
      |> line(end = [1, 0])
      |> line(end = [0, -1])
      |> close()
  }
}

x2 = test2()

x2.thing
  |> extrude(length = 10)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // ignore til we get loops
    async fn test_execute_with_function_sketch_loop_objects() {
        let ast = r#"fn box(obj) {
let myBox = startSketchOn(XY)
    |> startProfile(at = obj.start)
    |> line(end = [0, obj.l])
    |> line(end = [obj.w, 0])
    |> line(end = [0, -obj.l])
    |> close()
    |> extrude(length = obj.h)

  return myBox
}

for var in [{start: [0,0], l: 6, w: 10, h: 3}, {start: [-10,-10], l: 3, w: 5, h: 1.5}] {
  thisBox = box(var)
}"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // ignore til we get loops
    async fn test_execute_with_function_sketch_loop_array() {
        let ast = r#"fn box(h, l, w, start) {
 myBox = startSketchOn(XY)
    |> startProfile(at = [0,0])
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
        let ast = r#"fn box(@arr) {
 myBox =startSketchOn(XY)
    |> startProfile(at = arr[0])
    |> line(end = [0, arr[1]])
    |> line(end = [arr[2], 0])
    |> line(end = [0, -arr[1]])
    |> close()
    |> extrude(length = arr[3])

  return myBox
}

thisBox = box([[0,0], 6, 10, 3])

"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_function_cannot_access_future_definitions() {
        let ast = r#"
fn returnX() {
  // x shouldn't be defined yet.
  return x
}

x = 5

answer = returnX()"#;

        let result = parse_execute(ast).await;
        let err = result.unwrap_err();
        assert_eq!(err.message(), "`x` is not defined");
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
fn foo(@x: MyTy) {
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
fn foo() {
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
                source_ranges: vec![SourceRange::new(14, 15, ModuleId::default())],
            }),
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_pattern_transform_function_cannot_access_future_definitions() {
        let ast = r#"
fn transform(@replicaId) {
  // x shouldn't be defined yet.
  scale = x
  return {
    translate = [0, 0, replicaId * 10],
    scale = [scale, 1, 0],
  }
}

fn layer() {
  return startSketchOn(XY)
    |> circle( center= [0, 0], radius= 1, tag = $tag1)
    |> extrude(length = 10)
}

x = 5

// The 10 layers are replicas of each other, with a transform applied to each.
shape = layer() |> patternTransform(instances = 10, transform = transform)
"#;

        let result = parse_execute(ast).await;
        let err = result.unwrap_err();
        assert_eq!(err.message(), "`x` is not defined",);
    }

    // ADAM: Move some of these into simulation tests.

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_with_functions() {
        let ast = r#"myVar = 2 + min([100, -1 + legLen(hypotenuse = 5, leg = 3)])"#;
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
        let ast = r#"myVar = 1 + 2 * (3 - 4) / -5 + 6"#;
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
        let ast = r#"myVar = -5 + 6"#;
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
        let ast = r#"myVar = PI * 2"#;
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
        let ast = r#"thing = .4 + 7"#;
        let result = parse_execute(ast).await.unwrap();
        assert_eq!(
            7.4,
            mem_get_json(result.exec_state.stack(), result.mem_env, "thing")
                .as_f64()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_zero_param_fn() {
        let ast = r#"sigmaAllow = 35000 // psi
leg1 = 5 // inches
leg2 = 8 // inches
fn thickness() { return 0.56 }

bracket = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(end = [0, leg1])
  |> line(end = [leg2, 0])
  |> line(end = [0, -thickness()])
  |> line(end = [-leg2 + thickness(), 0])
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unary_operator_not_succeeds() {
        let ast = r#"
fn returnTrue() { return !false }
t = true
f = false
notTrue = !t
notFalse = !f
c = !!true
d = !returnTrue()

assertIs(!false, error = "expected to pass")

fn check(x) {
  assertIs(!x, error = "expected argument to be false")
  return true
}
check(x = false)
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
myNull = 0 / 0
notNull = !myNull
"#;
        assert_eq!(
            parse_execute(code1).await.unwrap_err().message(),
            "Cannot apply unary operator ! to non-boolean value: number(default units)",
        );

        let code2 = "notZero = !0";
        assert_eq!(
            parse_execute(code2).await.unwrap_err().message(),
            "Cannot apply unary operator ! to non-boolean value: number(default units)",
        );

        let code3 = r#"
notEmptyString = !""
"#;
        assert_eq!(
            parse_execute(code3).await.unwrap_err().message(),
            "Cannot apply unary operator ! to non-boolean value: string",
        );

        let code4 = r#"
obj = { a = 1 }
notMember = !obj.a
"#;
        assert_eq!(
            parse_execute(code4).await.unwrap_err().message(),
            "Cannot apply unary operator ! to non-boolean value: number(default units)",
        );

        let code5 = "
a = []
notArray = !a";
        assert_eq!(
            parse_execute(code5).await.unwrap_err().message(),
            "Cannot apply unary operator ! to non-boolean value: [any; 0]",
        );

        let code6 = "
x = {}
notObject = !x";
        assert_eq!(
            parse_execute(code6).await.unwrap_err().message(),
            "Cannot apply unary operator ! to non-boolean value: {  }",
        );

        let code7 = "
fn x() { return 1 }
notFunction = !x";
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
myTagDeclarator = $myTag
notTagDeclarator = !myTagDeclarator";
        let tag_declarator_err = parse_execute(code8).await.unwrap_err();
        // These are currently printed out as JSON objects, so we don't want to
        // check the full error.
        assert!(
            tag_declarator_err
                .message()
                .starts_with("Cannot apply unary operator ! to non-boolean value: tag"),
            "Actual error: {:?}",
            tag_declarator_err
        );

        let code9 = "
myTagDeclarator = $myTag
notTagIdentifier = !myTag";
        let tag_identifier_err = parse_execute(code9).await.unwrap_err();
        // These are currently printed out as JSON objects, so we don't want to
        // check the full error.
        assert!(
            tag_identifier_err
                .message()
                .starts_with("Cannot apply unary operator ! to non-boolean value: tag"),
            "Actual error: {:?}",
            tag_identifier_err
        );

        let code10 = "notPipe = !(1 |> 2)";
        assert_eq!(
            // TODO: We don't currently parse this, but we should.  It should be
            // a runtime error instead.
            parse_execute(code10).await.unwrap_err(),
            KclError::Syntax(KclErrorDetails {
                message: "Unexpected token: !".to_owned(),
                source_ranges: vec![SourceRange::new(10, 11, ModuleId::default())],
            })
        );

        let code11 = "
fn identity(x) { return x }
notPipeSub = 1 |> identity(!%))";
        assert_eq!(
            // TODO: We don't currently parse this, but we should.  It should be
            // a runtime error instead.
            parse_execute(code11).await.unwrap_err(),
            KclError::Syntax(KclErrorDetails {
                message: "Unexpected token: |>".to_owned(),
                source_ranges: vec![SourceRange::new(44, 46, ModuleId::default())],
            })
        );

        // TODO: Add these tests when we support these types.
        // let notNan = !NaN
        // let notInfinity = !Infinity
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_negative_variable_in_binary_expression() {
        let ast = r#"sigmaAllow = 35000 // psi
width = 1 // inch

p = 150 // lbs
distance = 6 // inches
FOS = 2

leg1 = 5 // inches
leg2 = 8 // inches

thickness_squared = distance * p * FOS * 6 / sigmaAllow
thickness = 0.56 // inches. App does not support square root function yet

bracket = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(end = [0, leg1])
  |> line(end = [leg2, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-leg2 + thickness, 0])
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_function_no_return() {
        let ast = r#"fn test(@origin) {
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
        let ast = r#"sigmaAllow = 35000 // psi
width = 4 // inch
p = 150 // Force on shelf - lbs
distance = 6 // inches
FOS = 2
leg1 = 5 // inches
leg2 = 8 // inches
thickness_squared = (distance * p * FOS * 6 / (sigmaAllow - width))
thickness = 0.32 // inches. App does not support square root function yet
bracket = startSketchOn(XY)
  |> startProfile(at = [0,0])
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
        let ast = r#" sigmaAllow = 35000 // psi
width = 4 // inch
p = 150 // Force on shelf - lbs
distance = 6 // inches
FOS = 2
leg1 = 5 // inches
leg2 = 8 // inches
thickness_squared = distance * p * FOS * 6 / (sigmaAllow - width)
thickness = 0.32 // inches. App does not support square root function yet
bracket = startSketchOn(XY)
  |> startProfile(at = [0,0])
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
        let ast = r#"fn f() { return 1 }
x = f()
y = x + 1
z = f() + 1
w = f() + f()
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_ids_stable_between_executions() {
        let code = r#"sketch001 = startSketchOn(XZ)
|> startProfile(at = [61.74, 206.13])
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
|> startProfile(at = [62.74, 206.13])
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
        let code = r#"sketch001 = startSketchOn(XZ)
|> startProfile(at = [61.74, 206.13])
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

        let ctx2 = ExecutorContext::new_mock(None).await;
        let program2 = crate::Program::parse_no_errs("z = x + 1").unwrap();
        let result = ctx2.run_mock(program2, true).await.unwrap();
        assert_eq!(result.variables.get("z").unwrap().as_f64().unwrap(), 3.0);

        ctx.close().await;
        ctx2.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn read_tag_version() {
        let ast = r#"fn bar(@t) {
  return startSketchOn(XY)
    |> startProfile(at = [0,0])
    |> angledLine(
        angle = -60,
        length = segLen(t),
    )
    |> line(end = [0, 0])
    |> close()
}

sketch = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(end = [0, 10])
  |> line(end = [10, 0], tag = $tag0)
  |> line(end = [0, 0])

fn foo() {
  // tag0 tags an edge
  return bar(tag0)
}

solid = sketch |> extrude(length = 10)
// tag0 tags a face
sketch2 = startSketchOn(solid, face = tag0)
  |> startProfile(at = [0,0])
  |> line(end = [0, 1])
  |> line(end = [1, 0])
  |> line(end = [0, 0])

foo() |> extrude(length = 1)
"#;
        parse_execute(ast).await.unwrap();
    }
}
