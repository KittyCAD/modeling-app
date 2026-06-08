//! Transport-neutral API types for KCL execution and frontend state.

#![allow(async_fn_in_trait)]

use serde::Deserialize;
use serde::Serialize;

pub trait LifecycleApi {
    async fn open_project(&self, project: ProjectId, files: Vec<File>, open_file: FileId) -> Result<()>;
    async fn get_project(&self, project: ProjectId) -> Result<Vec<File>>;
    async fn add_file(&self, project: ProjectId, file: File) -> Result<()>;
    async fn get_file(&self, project: ProjectId, file: FileId) -> Result<File>;
    async fn remove_file(&self, project: ProjectId, file: FileId) -> Result<()>;
    async fn update_file(&self, project: ProjectId, file: FileId, text: String) -> Result<()>;
    async fn switch_file(&self, project: ProjectId, file: FileId) -> Result<()>;
    async fn refresh(&self, project: ProjectId) -> Result<()>;
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct SceneGraph<Settings, Object> {
    pub project: ProjectId,
    pub file: FileId,
    pub version: Version,

    pub objects: Vec<Object>,
    pub settings: Settings,
    pub sketch_mode: Option<ObjectId>,
}

impl<Settings: Default, Object> SceneGraph<Settings, Object> {
    pub fn empty(project: ProjectId, file: FileId, version: Version) -> Self {
        SceneGraph {
            project,
            file,
            version,
            objects: Vec::new(),
            settings: Default::default(),
            sketch_mode: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct SceneGraphDelta<SceneGraph, ExecOutcome> {
    pub new_graph: SceneGraph,
    pub new_objects: Vec<ObjectId>,
    pub invalidates_ids: bool,
    pub exec_outcome: ExecOutcome,
}

impl<SceneGraph, ExecOutcome> SceneGraphDelta<SceneGraph, ExecOutcome> {
    pub fn new(
        new_graph: SceneGraph,
        new_objects: Vec<ObjectId>,
        invalidates_ids: bool,
        exec_outcome: ExecOutcome,
    ) -> Self {
        SceneGraphDelta {
            new_graph,
            new_objects,
            invalidates_ids,
            exec_outcome,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct SourceDelta {
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, ts_rs::TS)]
pub struct SketchCheckpointId(u64);

impl SketchCheckpointId {
    pub fn new(n: u64) -> Self {
        Self(n)
    }
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct SketchMutationOutcome<SceneGraphDelta> {
    pub source_delta: SourceDelta,
    pub scene_graph_delta: SceneGraphDelta,
    pub checkpoint_id: Option<SketchCheckpointId>,
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct NewSketchOutcome<SceneGraphDelta> {
    pub source_delta: SourceDelta,
    pub scene_graph_delta: SceneGraphDelta,
    pub sketch_id: ObjectId,
    pub checkpoint_id: Option<SketchCheckpointId>,
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct EditSketchOutcome<SceneGraphDelta> {
    pub scene_graph_delta: SceneGraphDelta,
    pub checkpoint_id: Option<SketchCheckpointId>,
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct RestoreSketchCheckpointOutcome<SceneGraphDelta> {
    pub source_delta: SourceDelta,
    pub scene_graph_delta: SceneGraphDelta,
}

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, PartialOrd, Ord, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiObjectId")]
pub struct ObjectId(pub usize);

impl ObjectId {
    pub fn predecessor(self) -> Option<Self> {
        self.0.checked_sub(1).map(ObjectId)
    }
}

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Ord, PartialOrd, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiVersion")]
pub struct Version(pub usize);

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiProjectId")]
pub struct ProjectId(pub usize);

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiFileId")]
pub struct FileId(pub usize);

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiFile")]
pub struct File {
    pub id: FileId,
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Error {
    pub msg: String,
}

impl Error {
    pub fn file_id_in_use(id: FileId, path: &str) -> Self {
        Error {
            msg: format!("File ID already in use: {id:?}, currently used for `{path}`"),
        }
    }

    pub fn file_id_not_found(project_id: ProjectId, file_id: FileId) -> Self {
        Error {
            msg: format!("File ID not found in project: {file_id:?}, project: {project_id:?}"),
        }
    }

    pub fn bad_project(found: ProjectId, expected: Option<ProjectId>) -> Self {
        let msg = match expected {
            Some(expected) => format!("Project ID mismatch found: {found:?}, expected: {expected:?}"),
            None => format!("No open project, found: {found:?}"),
        };
        Error { msg }
    }

    pub fn bad_version(found: Version, expected: Version) -> Self {
        Error {
            msg: format!("Version mismatch found: {found:?}, expected: {expected:?}"),
        }
    }

    pub fn bad_file(found: FileId, expected: Option<FileId>) -> Self {
        let msg = match expected {
            Some(expected) => format!("File ID mismatch found: {found:?}, expected: {expected:?}"),
            None => format!("File ID not found: {found:?}"),
        };
        Error { msg }
    }

    pub fn serialize(e: impl serde::ser::Error) -> Self {
        Error {
            msg: format!(
                "Could not serialize successful KCL result. This is a bug in KCL and not in your code, please report this to Zoo. Details: {e}"
            ),
        }
    }

    pub fn deserialize(name: &str, e: impl serde::de::Error) -> Self {
        Error {
            msg: format!(
                "Could not deserialize argument `{name}`. This is a bug in KCL and not in your code, please report this to Zoo. Details: {e}"
            ),
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
