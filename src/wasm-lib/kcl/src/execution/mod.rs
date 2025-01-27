//! The executor for the AST.

use std::{path::PathBuf, sync::Arc};

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::{
    each_cmd as mcmd,
    ok_response::{output::TakeSnapshot, OkModelingCmdResponse},
    websocket::{ModelingSessionData, OkWebSocketResponseData},
    ImageFormat, ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    engine::EngineManager,
    errors::KclError,
    execution::{
        artifact::build_artifact_graph,
        cache::{CacheInformation, CacheResult},
    },
    fs::FileManager,
    parsing::ast::types::{Expr, FunctionExpression, Node, NodeRef, Program as AstProgram},
    settings::types::UnitLength,
    source_range::{ModuleId, SourceRange},
    std::{args::Arg, StdLib},
    walk::Node as WalkNode,
    ExecError, KclErrorWithOutputs, Program,
};

pub(crate) mod annotations;
mod artifact;
pub(crate) mod cache;
mod cad_op;
mod exec_ast;
mod geometry;
mod import;
pub(crate) mod kcl_value;
mod memory;
mod state;

pub use artifact::{Artifact, ArtifactCommand, ArtifactGraph, ArtifactId};
pub use cad_op::Operation;
pub use exec_ast::FunctionParam;
pub use geometry::*;
pub(crate) use import::{import_foreign, send_to_engine as send_import_to_engine, ZOO_COORD_SYSTEM};
pub use kcl_value::{KclObjectFields, KclValue, UnitAngle, UnitLen};
pub use memory::ProgramMemory;
pub use state::{ExecState, IdGenerator, MetaSettings};

/// Outcome of executing a program.  This is used in TS.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutcome {
    /// Program variable bindings of the top-level module.
    pub memory: ProgramMemory,
    /// Operations that have been performed in execution order, for display in
    /// the Feature Tree.
    pub operations: Vec<Operation>,
    /// Output map of UUIDs to artifacts.
    pub artifacts: IndexMap<ArtifactId, Artifact>,
    /// Output commands to allow building the artifact graph by the caller.
    pub artifact_commands: Vec<ArtifactCommand>,
    /// Output artifact graph.
    pub artifact_graph: ArtifactGraph,
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
    pub info: Option<TagEngineInfo>,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
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
            info: None,
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

pub type MemoryFunction =
    fn(
        s: Vec<Arg>,
        memory: ProgramMemory,
        expression: crate::parsing::ast::types::BoxNode<FunctionExpression>,
        metadata: Vec<Metadata>,
        exec_state: &ExecState,
        ctx: ExecutorContext,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Option<KclValue>, KclError>> + Send>>;

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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum BodyType {
    Root,
    Sketch,
    Block,
}

/// Info about a module.  Right now, this is pretty minimal.  We hope to cache
/// modules here in the future.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct ModuleInfo {
    /// The ID of the module.
    id: ModuleId,
    /// Absolute path of the module's source file.
    path: std::path::PathBuf,
    repr: ModuleRepr,
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub enum ModuleRepr {
    Root,
    Kcl(Node<AstProgram>),
    Foreign(import::PreImportedGeometry),
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
    /// The project-default unit to use in modeling dimensions.
    pub units: UnitLength,
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
            units: Default::default(),
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
            units: config.settings.modeling.base_unit,
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
            units: config.settings.modeling.base_unit,
            highlight_edges: config.settings.modeling.highlight_edges.into(),
            enable_ssao: config.settings.modeling.enable_ssao.into(),
            show_grid: config.settings.modeling.show_scale_grid,
            replay: None,
            project_directory: None,
            current_file: None,
        }
    }
}

impl From<crate::settings::types::ModelingSettings> for ExecutorSettings {
    fn from(modeling: crate::settings::types::ModelingSettings) -> Self {
        Self {
            units: modeling.base_unit,
            highlight_edges: modeling.highlight_edges.into(),
            enable_ssao: modeling.enable_ssao.into(),
            show_grid: modeling.show_scale_grid,
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
    pub async fn new(
        engine_manager: crate::engine::conn_wasm::EngineCommandManager,
        fs_manager: crate::fs::wasm::FileSystemManager,
        settings: ExecutorSettings,
    ) -> Result<Self, String> {
        Ok(ExecutorContext {
            engine: Arc::new(Box::new(
                crate::engine::conn_wasm::EngineConnection::new(engine_manager)
                    .await
                    .map_err(|e| format!("{:?}", e))?,
            )),
            fs: Arc::new(FileManager::new(fs_manager)),
            stdlib: Arc::new(StdLib::new()),
            settings,
            context_type: ContextType::Live,
        })
    }

    #[cfg(target_arch = "wasm32")]
    pub async fn new_mock(
        fs_manager: crate::fs::wasm::FileSystemManager,
        settings: ExecutorSettings,
    ) -> Result<Self, String> {
        Ok(ExecutorContext {
            engine: Arc::new(Box::new(
                crate::engine::conn_mock::EngineConnection::new()
                    .await
                    .map_err(|e| format!("{:?}", e))?,
            )),
            fs: Arc::new(FileManager::new(fs_manager)),
            stdlib: Arc::new(StdLib::new()),
            settings,
            context_type: ContextType::Mock,
        })
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
    pub async fn new_with_default_client(units: UnitLength) -> Result<Self> {
        // Create the client.
        let ctx = Self::new_with_client(
            ExecutorSettings {
                units,
                ..Default::default()
            },
            None,
            None,
        )
        .await?;
        Ok(ctx)
    }

    pub fn is_mock(&self) -> bool {
        self.context_type == ContextType::Mock || self.context_type == ContextType::MockCustomForwarded
    }

    /// For executing unit tests.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new_for_unit_test(units: UnitLength, engine_addr: Option<String>) -> Result<Self> {
        let ctx = ExecutorContext::new_with_client(
            ExecutorSettings {
                units,
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

    pub async fn reset_scene(
        &self,
        exec_state: &mut ExecState,
        source_range: crate::execution::SourceRange,
    ) -> Result<(), KclError> {
        self.engine
            .clear_scene(&mut exec_state.global.id_generator, source_range)
            .await?;

        // We do not create the planes here as the post hook in wasm will do that
        // AND if we aren't in wasm it doesn't really matter.
        Ok(())
    }

    /// Given an old ast, old program memory and new ast, find the parts of the code that need to be
    /// re-executed.
    /// This function should never error, because in the case of any internal error, we should just pop
    /// the cache.
    ///
    /// Returns `None` when there are no changes to the program, i.e. it is
    /// fully cached.
    pub async fn get_changed_program(&self, info: CacheInformation) -> Option<CacheResult> {
        let Some(old) = info.old else {
            // We have no old info, we need to re-execute the whole thing.
            return Some(CacheResult {
                clear_scene: true,
                program: info.new_ast,
            });
        };

        // If the settings are different we might need to bust the cache.
        // We specifically do this before checking if they are the exact same.
        if old.settings != self.settings {
            // If the units are different we need to re-execute the whole thing.
            if old.settings.units != self.settings.units {
                return Some(CacheResult {
                    clear_scene: true,
                    program: info.new_ast,
                });
            }

            // If anything else is different we do not need to re-execute, but rather just
            // run the settings again.

            if self
                .engine
                .reapply_settings(&self.settings, Default::default())
                .await
                .is_err()
            {
                // Bust the cache, we errored.
                return Some(CacheResult {
                    clear_scene: true,
                    program: info.new_ast,
                });
            }
        }

        // If the ASTs are the EXACT same we return None.
        // We don't even need to waste time computing the digests.
        if old.ast == info.new_ast {
            return None;
        }

        let mut old_ast = old.ast;
        let mut new_ast = info.new_ast;

        // The digests should already be computed, but just in case we don't
        // want to compare against none.
        old_ast.compute_digest();
        new_ast.compute_digest();

        // Check if the digest is the same.
        if old_ast.digest == new_ast.digest {
            return None;
        }

        // Check if the changes were only to Non-code areas, like comments or whitespace.
        Some(Self::generate_changed_program(old_ast, new_ast))
    }

    /// Force-generate a new CacheResult, even if one shouldn't be made. The
    /// way in which this gets invoked should always be through
    /// [Self::get_changed_program]. This is purely to contain the logic on
    /// how we construct a new [CacheResult].
    fn generate_changed_program(old_ast: Node<AstProgram>, new_ast: Node<AstProgram>) -> CacheResult {
        let mut generated_program = new_ast.clone();
        generated_program.body = vec![];

        if !old_ast.body.iter().zip(new_ast.body.iter()).all(|(old, new)| {
            let old_node: WalkNode = old.into();
            let new_node: WalkNode = new.into();
            old_node.digest() == new_node.digest()
        }) {
            // If any of the nodes are different in the stretch of body that
            // overlaps, we have to bust cache and rebuild the scene. This
            // means a single insertion or deletion will result in a cache
            // bust.

            return CacheResult {
                clear_scene: true,
                program: new_ast,
            };
        }

        // otherwise the overlapping section of the ast bodies matches.
        // Let's see what the rest of the slice looks like.

        match new_ast.body.len().cmp(&old_ast.body.len()) {
            std::cmp::Ordering::Less => {
                // the new AST is shorter than the old AST -- statements
                // were removed from the "current" code in the "new" code.
                //
                // Statements up until now match which means this is a
                // "pure delete" of the remaining slice, when we get to
                // supporting that.

                // Cache bust time.
                CacheResult {
                    clear_scene: true,
                    program: new_ast,
                }
            }
            std::cmp::Ordering::Greater => {
                // the new AST is longer than the old AST, which means
                // statements were added to the new code we haven't previously
                // seen.
                //
                // Statements up until now are the same, which means this
                // is a "pure addition" of the remaining slice.

                generated_program
                    .body
                    .extend_from_slice(&new_ast.body[old_ast.body.len()..]);

                CacheResult {
                    clear_scene: false,
                    program: generated_program,
                }
            }
            std::cmp::Ordering::Equal => {
                // currently unreachable, but let's pretend like the code
                // above can do something meaningful here for when we get
                // to diffing and yanking chunks of the program apart.

                // We don't actually want to do anything here; so we're going
                // to not clear and do nothing. Is this wrong? I don't think
                // so but i think many things. This def needs to change
                // when the code above changes.

                CacheResult {
                    clear_scene: false,
                    program: generated_program,
                }
            }
        }
    }

    /// Perform the execution of a program.
    ///
    /// You can optionally pass in some initialization memory for partial
    /// execution.
    pub async fn run(&self, cache_info: CacheInformation, exec_state: &mut ExecState) -> Result<(), KclError> {
        self.run_with_session_data(cache_info, exec_state).await?;
        Ok(())
    }

    /// Perform the execution of a program.
    ///
    /// You can optionally pass in some initialization memory for partial
    /// execution.
    ///
    /// The error includes additional outputs used for the feature tree and
    /// artifact graph.
    pub async fn run_with_ui_outputs(
        &self,
        cache_info: CacheInformation,
        exec_state: &mut ExecState,
    ) -> Result<(), KclErrorWithOutputs> {
        self.inner_run(cache_info, exec_state).await?;
        Ok(())
    }

    /// Perform the execution of a program.  Additionally return engine session
    /// data.
    pub async fn run_with_session_data(
        &self,
        cache_info: CacheInformation,
        exec_state: &mut ExecState,
    ) -> Result<Option<ModelingSessionData>, KclError> {
        self.inner_run(cache_info, exec_state).await.map_err(|e| e.into())
    }

    /// Perform the execution of a program.  Accept all possible parameters and
    /// output everything.
    ///
    /// You can optionally pass in some initialization memory for partial
    /// execution.
    async fn inner_run(
        &self,
        cache_info: CacheInformation,
        exec_state: &mut ExecState,
    ) -> Result<Option<ModelingSessionData>, KclErrorWithOutputs> {
        let _stats = crate::log::LogPerfStats::new("Interpretation");

        // Get the program that actually changed from the old and new information.
        let cache_result = self.get_changed_program(cache_info.clone()).await;

        // Check if we don't need to re-execute.
        let Some(cache_result) = cache_result else {
            return Ok(None);
        };

        if cache_result.clear_scene && !self.is_mock() {
            // Pop the execution state, since we are starting fresh.
            exec_state.reset(&self.settings);

            // We don't do this in mock mode since there is no engine connection
            // anyways and from the TS side we override memory and don't want to clear it.
            self.reset_scene(exec_state, Default::default())
                .await
                .map_err(KclErrorWithOutputs::no_outputs)?;
        }

        // Re-apply the settings, in case the cache was busted.
        self.engine
            .reapply_settings(&self.settings, Default::default())
            .await
            .map_err(KclErrorWithOutputs::no_outputs)?;

        self.execute_and_build_graph(&cache_result.program, exec_state)
            .await
            .map_err(|e| {
                KclErrorWithOutputs::new(
                    e,
                    exec_state.mod_local.operations.clone(),
                    exec_state.global.artifact_commands.clone(),
                    exec_state.global.artifact_graph.clone(),
                )
            })?;

        let session_data = self.engine.get_session_data();
        Ok(session_data)
    }

    /// Execute an AST's program and build auxiliary outputs like the artifact
    /// graph.
    async fn execute_and_build_graph<'a>(
        &self,
        program: NodeRef<'a, crate::parsing::ast::types::Program>,
        exec_state: &mut ExecState,
    ) -> Result<Option<KclValue>, KclError> {
        // Don't early return!  We need to build other outputs regardless of
        // whether execution failed.
        let exec_result = self
            .exec_program(program, exec_state, crate::execution::BodyType::Root)
            .await;
        // Move the artifact commands and responses to simplify cache management
        // and error creation.
        exec_state
            .global
            .artifact_commands
            .extend(self.engine.take_artifact_commands());
        exec_state.global.artifact_responses.extend(self.engine.responses());
        // Build the artifact graph.
        match build_artifact_graph(
            &exec_state.global.artifact_commands,
            &exec_state.global.artifact_responses,
            program,
            &exec_state.global.artifacts,
        ) {
            Ok(artifact_graph) => {
                exec_state.global.artifact_graph = artifact_graph;
                exec_result
            }
            Err(err) => {
                // Prefer the exec error.
                exec_result.and(Err(err))
            }
        }
    }

    /// Update the units for the executor.
    pub fn update_units(&mut self, units: UnitLength) {
        self.settings.units = units;
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

    /// Execute the program, then get a PNG screenshot.
    pub async fn execute_and_prepare_snapshot(
        &self,
        program: &Program,
        exec_state: &mut ExecState,
    ) -> std::result::Result<TakeSnapshot, ExecError> {
        self.run_with_ui_outputs(program.clone().into(), exec_state).await?;

        self.prepare_snapshot().await
    }

    pub async fn close(&self) {
        self.engine.close().await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use pretty_assertions::assert_eq;

    use super::*;
    use crate::{
        parsing::ast::types::{DefaultParamVal, Identifier, Node, Parameter},
        OldAstState,
    };

    async fn parse_execute(code: &str) -> Result<(Program, ExecutorContext, ExecState)> {
        let program = Program::parse_no_errs(code)?;

        let ctx = ExecutorContext {
            engine: Arc::new(Box::new(crate::engine::conn_mock::EngineConnection::new().await?)),
            fs: Arc::new(crate::fs::FileManager::new()),
            stdlib: Arc::new(crate::std::StdLib::new()),
            settings: Default::default(),
            context_type: ContextType::Mock,
        };
        let mut exec_state = ExecState::new(&ctx.settings);
        ctx.run(program.clone().into(), &mut exec_state).await?;

        Ok((program, ctx, exec_state))
    }

    /// Convenience function to get a JSON value from memory and unwrap.
    #[track_caller]
    fn mem_get_json(memory: &ProgramMemory, name: &str) -> KclValue {
        memory.get(name, SourceRange::default()).unwrap().to_owned()
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
part001 = startSketchOn('XY')
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
const part001 = startSketchOn('XY')
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
const part001 = startSketchOn('XY')
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

const part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> yLineTo(1, %)
  |> xLine(3.84, %) // selection-range-7ish-before-this

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

const firstExtrude = startSketchOn('XY')
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

const firstExtrude = startSketchOn('XY')
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

const firstExtrude = startSketchOn('XY')
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

const firstExtrude = startSketchOn('XY')
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
 const myBox = startSketchOn('XY')
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
 let myBox = startSketchOn('XY')
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
 let myBox = startSketchOn('XY')
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
 let myBox = startSketchOn('XY')
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
    thing: startSketchOn('XY')
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
let myBox = startSketchOn('XY')
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
 const myBox = startSketchOn('XY')
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
 let myBox =startSketchOn('XY')
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
        let err = result.unwrap_err().downcast::<KclError>().unwrap();
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
    async fn test_cannot_shebang_in_fn() {
        let ast = r#"
fn foo () {
  #!hello
  return true
}

foo
"#;

        let result = parse_execute(ast).await;
        let err = result.unwrap_err().downcast::<KclError>().unwrap();
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
  return startSketchOn("XY")
    |> circle({ center: [0, 0], radius: 1 }, %, $tag1)
    |> extrude(length = 10)
}

const x = 5

// The 10 layers are replicas of each other, with a transform applied to each.
let shape = layer() |> patternTransform(10, transform, %)
"#;

        let result = parse_execute(ast).await;
        let err = result.unwrap_err().downcast::<KclError>().unwrap();
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
        let (_, _, exec_state) = parse_execute(ast).await.unwrap();
        assert_eq!(5.0, mem_get_json(exec_state.memory(), "myVar").as_f64().unwrap());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute() {
        let ast = r#"const myVar = 1 + 2 * (3 - 4) / -5 + 6"#;
        let (_, _, exec_state) = parse_execute(ast).await.unwrap();
        assert_eq!(7.4, mem_get_json(exec_state.memory(), "myVar").as_f64().unwrap());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_start_negative() {
        let ast = r#"const myVar = -5 + 6"#;
        let (_, _, exec_state) = parse_execute(ast).await.unwrap();
        assert_eq!(1.0, mem_get_json(exec_state.memory(), "myVar").as_f64().unwrap());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_with_pi() {
        let ast = r#"const myVar = pi() * 2"#;
        let (_, _, exec_state) = parse_execute(ast).await.unwrap();
        assert_eq!(
            std::f64::consts::TAU,
            mem_get_json(exec_state.memory(), "myVar").as_f64().unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_define_decimal_without_leading_zero() {
        let ast = r#"let thing = .4 + 7"#;
        let (_, _, exec_state) = parse_execute(ast).await.unwrap();
        assert_eq!(7.4, mem_get_json(exec_state.memory(), "thing").as_f64().unwrap());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unit_default() {
        let ast = r#"const inMm = 25.4 * mm()
const inInches = 1.0 * inch()"#;
        let (_, _, exec_state) = parse_execute(ast).await.unwrap();
        assert_eq!(25.4, mem_get_json(exec_state.memory(), "inMm").as_f64().unwrap());
        assert_eq!(25.4, mem_get_json(exec_state.memory(), "inInches").as_f64().unwrap());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unit_overriden() {
        let ast = r#"@settings(defaultLengthUnit = inch)
const inMm = 25.4 * mm()
const inInches = 1.0 * inch()"#;
        let (_, _, exec_state) = parse_execute(ast).await.unwrap();
        assert_eq!(1.0, mem_get_json(exec_state.memory(), "inMm").as_f64().unwrap().round());
        assert_eq!(1.0, mem_get_json(exec_state.memory(), "inInches").as_f64().unwrap());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unit_overriden_in() {
        let ast = r#"@settings(defaultLengthUnit = in)
const inMm = 25.4 * mm()
const inInches = 2.0 * inch()"#;
        let (_, _, exec_state) = parse_execute(ast).await.unwrap();
        assert_eq!(1.0, mem_get_json(exec_state.memory(), "inMm").as_f64().unwrap().round());
        assert_eq!(2.0, mem_get_json(exec_state.memory(), "inInches").as_f64().unwrap());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_zero_param_fn() {
        let ast = r#"const sigmaAllow = 35000 // psi
const leg1 = 5 // inches
const leg2 = 8 // inches
fn thickness = () => { return 0.56 }

const bracket = startSketchOn('XY')
  |> startProfileAt([0,0], %)
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
        let (_, _, exec_state) = parse_execute(ast).await.unwrap();
        assert_eq!(false, mem_get_json(exec_state.memory(), "notTrue").as_bool().unwrap());
        assert_eq!(true, mem_get_json(exec_state.memory(), "notFalse").as_bool().unwrap());
        assert_eq!(true, mem_get_json(exec_state.memory(), "c").as_bool().unwrap());
        assert_eq!(false, mem_get_json(exec_state.memory(), "d").as_bool().unwrap());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_unary_operator_not_on_non_bool_fails() {
        let code1 = r#"
// Yup, this is null.
let myNull = 0 / 0
let notNull = !myNull
"#;
        assert_eq!(
            parse_execute(code1).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: number".to_owned(),
                source_ranges: vec![SourceRange::new(56, 63, ModuleId::default())],
            })
        );

        let code2 = "let notZero = !0";
        assert_eq!(
            parse_execute(code2).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: number".to_owned(),
                source_ranges: vec![SourceRange::new(14, 16, ModuleId::default())],
            })
        );

        let code3 = r#"
let notEmptyString = !""
"#;
        assert_eq!(
            parse_execute(code3).await.unwrap_err().downcast::<KclError>().unwrap(),
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
            parse_execute(code4).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: number".to_owned(),
                source_ranges: vec![SourceRange::new(36, 42, ModuleId::default())],
            })
        );

        let code5 = "
let a = []
let notArray = !a";
        assert_eq!(
            parse_execute(code5).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: array (list)".to_owned(),
                source_ranges: vec![SourceRange::new(27, 29, ModuleId::default())],
            })
        );

        let code6 = "
let x = {}
let notObject = !x";
        assert_eq!(
            parse_execute(code6).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: object".to_owned(),
                source_ranges: vec![SourceRange::new(28, 30, ModuleId::default())],
            })
        );

        let code7 = "
fn x = () => { return 1 }
let notFunction = !x";
        let fn_err = parse_execute(code7).await.unwrap_err().downcast::<KclError>().unwrap();
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
        let tag_declarator_err = parse_execute(code8).await.unwrap_err().downcast::<KclError>().unwrap();
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
        let tag_identifier_err = parse_execute(code9).await.unwrap_err().downcast::<KclError>().unwrap();
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
            parse_execute(code10).await.unwrap_err().downcast::<KclError>().unwrap(),
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
            parse_execute(code11).await.unwrap_err().downcast::<KclError>().unwrap(),
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

const bracket = startSketchOn('XY')
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
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Result of user-defined function test is undefined"),);
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
const bracket = startSketchOn('XY')
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
const bracket = startSketchOn('XY')
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

    #[test]
    fn test_assign_args_to_params() {
        // Set up a little framework for this test.
        fn mem(number: usize) -> KclValue {
            KclValue::Int {
                value: number as i64,
                meta: Default::default(),
            }
        }
        fn ident(s: &'static str) -> Node<Identifier> {
            Node::no_src(Identifier {
                name: s.to_owned(),
                digest: None,
            })
        }
        fn opt_param(s: &'static str) -> Parameter {
            Parameter {
                identifier: ident(s),
                type_: None,
                default_value: Some(DefaultParamVal::none()),
                labeled: true,
                digest: None,
            }
        }
        fn req_param(s: &'static str) -> Parameter {
            Parameter {
                identifier: ident(s),
                type_: None,
                default_value: None,
                labeled: true,
                digest: None,
            }
        }
        fn additional_program_memory(items: &[(String, KclValue)]) -> ProgramMemory {
            let mut program_memory = ProgramMemory::new();
            for (name, item) in items {
                program_memory
                    .add(name.as_str(), item.clone(), SourceRange::default())
                    .unwrap();
            }
            program_memory
        }
        // Declare the test cases.
        for (test_name, params, args, expected) in [
            ("empty", Vec::new(), Vec::new(), Ok(ProgramMemory::new())),
            (
                "all params required, and all given, should be OK",
                vec![req_param("x")],
                vec![mem(1)],
                Ok(additional_program_memory(&[("x".to_owned(), mem(1))])),
            ),
            (
                "all params required, none given, should error",
                vec![req_param("x")],
                vec![],
                Err(KclError::Semantic(KclErrorDetails {
                    source_ranges: vec![SourceRange::default()],
                    message: "Expected 1 arguments, got 0".to_owned(),
                })),
            ),
            (
                "all params optional, none given, should be OK",
                vec![opt_param("x")],
                vec![],
                Ok(additional_program_memory(&[("x".to_owned(), KclValue::none())])),
            ),
            (
                "mixed params, too few given",
                vec![req_param("x"), opt_param("y")],
                vec![],
                Err(KclError::Semantic(KclErrorDetails {
                    source_ranges: vec![SourceRange::default()],
                    message: "Expected 1-2 arguments, got 0".to_owned(),
                })),
            ),
            (
                "mixed params, minimum given, should be OK",
                vec![req_param("x"), opt_param("y")],
                vec![mem(1)],
                Ok(additional_program_memory(&[
                    ("x".to_owned(), mem(1)),
                    ("y".to_owned(), KclValue::none()),
                ])),
            ),
            (
                "mixed params, maximum given, should be OK",
                vec![req_param("x"), opt_param("y")],
                vec![mem(1), mem(2)],
                Ok(additional_program_memory(&[
                    ("x".to_owned(), mem(1)),
                    ("y".to_owned(), mem(2)),
                ])),
            ),
            (
                "mixed params, too many given",
                vec![req_param("x"), opt_param("y")],
                vec![mem(1), mem(2), mem(3)],
                Err(KclError::Semantic(KclErrorDetails {
                    source_ranges: vec![SourceRange::default()],
                    message: "Expected 1-2 arguments, got 3".to_owned(),
                })),
            ),
        ] {
            // Run each test.
            let func_expr = &Node::no_src(FunctionExpression {
                params,
                body: Node {
                    inner: crate::parsing::ast::types::Program {
                        body: Vec::new(),
                        non_code_meta: Default::default(),
                        shebang: None,
                        digest: None,
                    },
                    start: 0,
                    end: 0,
                    module_id: ModuleId::default(),
                },
                return_type: None,
                digest: None,
            });
            let args = args.into_iter().map(Arg::synthetic).collect();
            let actual = assign_args_to_params(func_expr, args, ProgramMemory::new());
            assert_eq!(
                actual, expected,
                "failed test '{test_name}':\ngot {actual:?}\nbut expected\n{expected:?}"
            );
        }
    }

    #[test]
    fn test_serialize_memory_item() {
        let mem = KclValue::Solids {
            value: Default::default(),
        };
        let json = serde_json::to_string(&mem).unwrap();
        assert_eq!(json, r#"{"type":"Solids","value":[]}"#);
    }

    // Easy case where we have no old ast and memory.
    // We need to re-execute everything.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_no_old_information() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;
        let (program, ctx, _) = parse_execute(new).await.unwrap();

        let result = ctx
            .get_changed_program(CacheInformation {
                old: None,
                new_ast: program.ast.clone(),
            })
            .await;

        assert!(result.is_some());

        let result = result.unwrap();

        assert_eq!(result.program, program.ast);
        assert!(result.clear_scene);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, ctx, exec_state) = parse_execute(new).await.unwrap();

        let result = ctx
            .get_changed_program(CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            })
            .await;

        assert_eq!(result, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_whitespace() {
        let old = r#" // Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program_old, ctx, exec_state) = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = ctx
            .get_changed_program(CacheInformation {
                old: Some(OldAstState {
                    ast: program_old.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program_new.ast.clone(),
            })
            .await;

        assert_eq!(result, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_code_comment_start_of_program() {
        let old = r#" // Removed the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, ctx, exec_state) = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = ctx
            .get_changed_program(CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program_new.ast.clone(),
            })
            .await;

        assert_eq!(result, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_code_comments() {
        let old = r#" // Removed the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0]) // my thing
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, ctx, exec_state) = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = ctx
            .get_changed_program(CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program_new.ast.clone(),
            })
            .await;

        assert!(result.is_none());
    }

    // Changing the units with the exact same file should bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_units() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, mut ctx, exec_state) = parse_execute(new).await.unwrap();

        // Change the settings to cm.
        ctx.settings.units = crate::UnitLength::Cm;

        let result = ctx
            .get_changed_program(CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            })
            .await;

        assert!(result.is_some());

        let result = result.unwrap();

        assert_eq!(result.program, program.ast);
        assert!(result.clear_scene);
    }

    // Changing the grid settings with the exact same file should NOT bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_grid_setting() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, mut ctx, exec_state) = parse_execute(new).await.unwrap();

        // Change the settings.
        ctx.settings.show_grid = !ctx.settings.show_grid;

        let result = ctx
            .get_changed_program(CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            })
            .await;

        assert_eq!(result, None);
    }

    // Changing the edge visibility settings with the exact same file should NOT bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_edge_visiblity_setting() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, mut ctx, exec_state) = parse_execute(new).await.unwrap();

        // Change the settings.
        ctx.settings.highlight_edges = !ctx.settings.highlight_edges;

        let result = ctx
            .get_changed_program(CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            })
            .await;

        assert_eq!(result, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_ids_stable_between_executions() {
        let code = r#"sketch001 = startSketchOn('XZ')
|> startProfileAt([61.74, 206.13], %)
|> xLine(305.11, %, $seg01)
|> yLine(-291.85, %)
|> xLine(-segLen(seg01), %)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
|> extrude(length = 40.14)
|> shell({
    faces: [seg01],
    thickness: 3.14,
}, %)
"#;

        let ctx = crate::test_server::new_context(UnitLength::Mm, true, None)
            .await
            .unwrap();
        let old_program = crate::Program::parse_no_errs(code).unwrap();
        // Execute the program.
        let mut exec_state = ExecState::new(&ctx.settings);
        let cache_info = crate::CacheInformation {
            old: None,
            new_ast: old_program.ast.clone(),
        };
        ctx.run(cache_info, &mut exec_state).await.unwrap();

        // Get the id_generator from the first execution.
        let id_generator = exec_state.global.id_generator.clone();

        let code = r#"sketch001 = startSketchOn('XZ')
|> startProfileAt([62.74, 206.13], %)
|> xLine(305.11, %, $seg01)
|> yLine(-291.85, %)
|> xLine(-segLen(seg01), %)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
|> extrude(length = 40.14)
|> shell({
    faces: [seg01],
    thickness: 3.14,
}, %)
"#;

        // Execute a slightly different program again.
        let program: Program = crate::Program::parse_no_errs(code).unwrap();
        let cache_info = crate::CacheInformation {
            old: Some(crate::OldAstState {
                ast: old_program.ast.clone(),
                exec_state: exec_state.clone(),
                settings: ctx.settings.clone(),
            }),
            new_ast: program.ast.clone(),
        };
        // Execute the program.
        ctx.run(cache_info, &mut exec_state).await.unwrap();

        assert_eq!(id_generator, exec_state.global.id_generator);
    }
}
