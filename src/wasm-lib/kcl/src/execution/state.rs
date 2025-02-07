use anyhow::Result;
use indexmap::IndexMap;
use kittycad_modeling_cmds::websocket::WebSocketResponse;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        annotations, kcl_value, Artifact, ArtifactCommand, ArtifactGraph, ArtifactId, ExecOutcome, ExecutorSettings,
        KclValue, Operation, ProgramMemory, UnitAngle, UnitLen,
    },
    modules::{ModuleId, ModuleInfo, ModuleLoader, ModulePath, ModuleRepr},
    parsing::ast::types::NonCodeValue,
    source_range::SourceRange,
};

/// State for executing a program.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecState {
    pub global: GlobalState,
    pub mod_local: ModuleState,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalState {
    /// Program variable bindings.
    pub memory: ProgramMemory,
    /// The stable artifact ID generator.
    pub id_generator: IdGenerator,
    /// Map from source file absolute path to module ID.
    pub path_to_source_id: IndexMap<ModulePath, ModuleId>,
    /// Map from module ID to module info.
    pub module_infos: IndexMap<ModuleId, ModuleInfo>,
    /// Output map of UUIDs to artifacts.
    pub artifacts: IndexMap<ArtifactId, Artifact>,
    /// Output commands to allow building the artifact graph by the caller.
    /// These are accumulated in the [`ExecutorContext`] but moved here for
    /// convenience of the execution cache.
    pub artifact_commands: Vec<ArtifactCommand>,
    /// Responses from the engine for `artifact_commands`.  We need to cache
    /// this so that we can build the artifact graph.  These are accumulated in
    /// the [`ExecutorContext`] but moved here for convenience of the execution
    /// cache.
    pub artifact_responses: IndexMap<Uuid, WebSocketResponse>,
    /// Output artifact graph.
    pub artifact_graph: ArtifactGraph,
    /// Module loader.
    pub mod_loader: ModuleLoader,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleState {
    /// The current value of the pipe operator returned from the previous
    /// expression.  If we're not currently in a pipeline, this will be None.
    pub pipe_value: Option<KclValue>,
    /// Identifiers that have been exported from the current module.
    pub module_exports: Vec<String>,
    /// Operations that have been performed in execution order, for display in
    /// the Feature Tree.
    pub operations: Vec<Operation>,
    /// Settings specified from annotations.
    pub settings: MetaSettings,
}

impl ExecState {
    pub fn new(exec_settings: &ExecutorSettings) -> Self {
        ExecState {
            global: GlobalState::new(exec_settings),
            mod_local: ModuleState::new(exec_settings),
        }
    }

    pub(super) fn reset(&mut self, exec_settings: &ExecutorSettings) {
        let mut id_generator = self.global.id_generator.clone();
        // We do not pop the ids, since we want to keep the same id generator.
        // This is for the front end to keep track of the ids.
        id_generator.next_id = 0;

        let mut global = GlobalState::new(exec_settings);
        global.id_generator = id_generator;

        *self = ExecState {
            global,
            mod_local: ModuleState::new(exec_settings),
        };
    }

    /// Convert to execution outcome when running in WebAssembly.  We want to
    /// reduce the amount of data that crosses the WASM boundary as much as
    /// possible.
    pub fn to_wasm_outcome(self) -> ExecOutcome {
        // Fields are opt-in so that we don't accidentally leak private internal
        // state when we add more to ExecState.
        ExecOutcome {
            variables: self
                .memory()
                .find_all_in_current_env(|_| true)
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            operations: self.mod_local.operations,
            artifacts: self.global.artifacts,
            artifact_commands: self.global.artifact_commands,
            artifact_graph: self.global.artifact_graph,
        }
    }

    pub fn memory(&self) -> &ProgramMemory {
        &self.global.memory
    }

    pub fn mut_memory(&mut self) -> &mut ProgramMemory {
        &mut self.global.memory
    }

    pub fn next_uuid(&mut self) -> Uuid {
        self.global.id_generator.next_uuid()
    }

    pub fn add_artifact(&mut self, artifact: Artifact) {
        let id = artifact.id();
        self.global.artifacts.insert(id, artifact);
    }

    pub(super) fn next_module_id(&self) -> ModuleId {
        ModuleId::from_usize(self.global.path_to_source_id.len())
    }

    pub(super) fn id_for_module(&self, path: &ModulePath) -> Option<ModuleId> {
        self.global.path_to_source_id.get(path).cloned()
    }

    pub(super) fn add_module(&mut self, id: ModuleId, path: ModulePath, repr: ModuleRepr) {
        debug_assert!(!self.global.path_to_source_id.contains_key(&path));

        self.global.path_to_source_id.insert(path.clone(), id);

        let module_info = ModuleInfo { id, repr, path };
        self.global.module_infos.insert(id, module_info);
    }

    pub fn length_unit(&self) -> UnitLen {
        self.mod_local.settings.default_length_units
    }

    pub fn angle_unit(&self) -> UnitAngle {
        self.mod_local.settings.default_angle_units
    }

    pub(super) fn circular_import_error(&self, path: &ModulePath, source_range: SourceRange) -> KclError {
        KclError::ImportCycle(KclErrorDetails {
            message: format!(
                "circular import of modules is not allowed: {} -> {}",
                self.global
                    .mod_loader
                    .import_stack
                    .iter()
                    .map(|p| p.as_path().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" -> "),
                path,
            ),
            source_ranges: vec![source_range],
        })
    }
}

impl GlobalState {
    fn new(settings: &ExecutorSettings) -> Self {
        let mut global = GlobalState {
            memory: ProgramMemory::new(),
            id_generator: Default::default(),
            path_to_source_id: Default::default(),
            module_infos: Default::default(),
            artifacts: Default::default(),
            artifact_commands: Default::default(),
            artifact_responses: Default::default(),
            artifact_graph: Default::default(),
            mod_loader: Default::default(),
        };

        let root_id = ModuleId::default();
        let root_path = settings.current_file.clone().unwrap_or_default();
        global.module_infos.insert(
            root_id,
            ModuleInfo {
                id: root_id,
                path: ModulePath::Local(root_path.clone()),
                repr: ModuleRepr::Root,
            },
        );
        global.path_to_source_id.insert(ModulePath::Local(root_path), root_id);
        global
    }
}

impl ModuleState {
    pub(super) fn new(exec_settings: &ExecutorSettings) -> Self {
        ModuleState {
            pipe_value: Default::default(),
            module_exports: Default::default(),
            operations: Default::default(),
            settings: MetaSettings {
                default_length_units: exec_settings.units.into(),
                default_angle_units: Default::default(),
            },
        }
    }
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MetaSettings {
    pub default_length_units: kcl_value::UnitLen,
    pub default_angle_units: kcl_value::UnitAngle,
}

impl MetaSettings {
    pub(crate) fn update_from_annotation(
        &mut self,
        annotation: &NonCodeValue,
        source_range: SourceRange,
    ) -> Result<(), KclError> {
        let properties = annotations::expect_properties(annotations::SETTINGS, annotation, source_range)?;

        for p in properties {
            match &*p.inner.key.name {
                annotations::SETTINGS_UNIT_LENGTH => {
                    let value = annotations::expect_ident(&p.inner.value)?;
                    let value = kcl_value::UnitLen::from_str(value, source_range)?;
                    self.default_length_units = value;
                }
                annotations::SETTINGS_UNIT_ANGLE => {
                    let value = annotations::expect_ident(&p.inner.value)?;
                    let value = kcl_value::UnitAngle::from_str(value, source_range)?;
                    self.default_angle_units = value;
                }
                name => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "Unexpected settings key: `{name}`; expected one of `{}`, `{}`",
                            annotations::SETTINGS_UNIT_LENGTH,
                            annotations::SETTINGS_UNIT_ANGLE
                        ),
                        source_ranges: vec![source_range],
                    }))
                }
            }
        }

        Ok(())
    }
}

/// A generator for ArtifactIds that can be stable across executions.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IdGenerator {
    pub(super) next_id: usize,
    ids: Vec<uuid::Uuid>,
}

impl IdGenerator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn next_uuid(&mut self) -> uuid::Uuid {
        if let Some(id) = self.ids.get(self.next_id) {
            self.next_id += 1;
            *id
        } else {
            let id = uuid::Uuid::new_v4();
            self.ids.push(id);
            self.next_id += 1;
            id
        }
    }
}
