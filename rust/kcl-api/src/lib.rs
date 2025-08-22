//! An API for controlling the KCL interpreter from the frontend.
#![allow(async_fn_in_trait)]

use kcl_error::SourceRange;
use serde::{Deserialize, Serialize};

pub trait LifecycleApi {
    async fn open_project(&self, project: ProjectId, files: Vec<File>, open_file: FileId) -> Result<SceneGraph>;
    async fn add_file(&self, project: ProjectId, file: File) -> Result<SceneGraphDelta>;
    async fn remove_file(&self, project: ProjectId, file: FileId) -> Result<SceneGraphDelta>;
    // File changed on disk, etc. outside of the editor or applying undo, restore, etc.
    async fn update_file(&self, project: ProjectId, file: FileId, text: String) -> Result<SceneGraphDelta>;
    async fn switch_file(&self, project: ProjectId, file: FileId) -> Result<SceneGraph>;
    async fn refresh(&self, project: ProjectId) -> Result<SceneGraph>;
}

pub trait SketchApi {
    async fn new_sketch(
        &self,
        project: ProjectId,
        file: FileId,
        version: Version,
        args: SketchArgs,
    ) -> Result<(SourceDelta, SceneGraphDelta, ObjectId)>;

    async fn edit_sketch(
        &self,
        project: ProjectId,
        file: FileId,
        version: Version,
        sketch: ObjectId,
    ) -> Result<SceneGraphDelta>;
    async fn exit_sketch(sketch: ObjectId) -> Result<SceneGraph>;
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct SceneGraph {
    pub project: ProjectId,
    pub file: FileId,
    pub version: Version,

    pub objects: Vec<Object>,
    pub settings: Settings,
    pub sketch_mode: Option<ObjectId>,
}

impl SceneGraph {
    pub fn empty(project: ProjectId, file: FileId, version: Version) -> Self {
        SceneGraph {
            project,
            file,
            version,
            objects: Vec::new(),
            settings: Settings {},
            sketch_mode: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct SceneGraphDelta {
    pub new_graph: SceneGraph,
    pub invalidates_ids: bool,
}

impl SceneGraphDelta {
    pub fn new(new_graph: SceneGraph, invalidates_ids: bool) -> Self {
        SceneGraphDelta {
            new_graph,
            invalidates_ids,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct SourceDelta {}

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiObjectId")]
pub struct ObjectId(pub usize);

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Ord, PartialOrd, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiVersion")]
pub struct Version(pub usize);

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiProjectId")]
pub struct ProjectId(pub usize);

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiFileId")]
pub struct FileId(pub usize);

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiFile")]
pub struct File {
    pub id: FileId,
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, rename = "ApiSettings")]
pub struct Settings {}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub struct Object {
    pub id: ObjectId,
    pub kind: ObjectKind,
    pub artifact_id: usize,
    pub source: SourceRef,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub enum ObjectKind {
    Sketch(Sketch),
    Segment(Segment),
    Constraint,
    Sweep,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub struct Sketch {
    pub args: SketchArgs,
    pub items: Vec<ObjectId>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub struct SketchArgs {
    pub on: Plane,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub enum Plane {
    Object(ObjectId),
    Default,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
// TODO: arcs
pub struct Segment {
    pub from: Point2d,
    pub to: Point2d,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub enum Constraint {
    EqualLength(Vec<ObjectId>),
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ts_rs::TS)]
pub struct Point2d {
    // TODO: units?
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub enum SourceRef {
    Simple(SourceRange),
    BackTrace(Vec<SourceRange>),
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub struct Error {
    pub msg: String,
}

impl Error {
    pub fn file_id_in_use(id: FileId, path: &str) -> Self {
        Error {
            msg: format!("File ID already in use: {id:?}, currently used for `{path}`"),
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
