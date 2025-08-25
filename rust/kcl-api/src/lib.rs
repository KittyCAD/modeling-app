//! An API for controlling the KCL interpreter from the frontend.
#![allow(async_fn_in_trait)]

use kcl_error::SourceRange;

pub trait LifecycleApi {
    async fn open_project(project: ProjectId, files: Vec<File>, open_file: FileId) -> Result<SceneGraph>;
    async fn add_file(project: ProjectId, file: File) -> Result<SceneGraphDelta>;
    async fn remove_file(project: ProjectId, file: FileId) -> Result<SceneGraphDelta>;
    // File changed on disk, etc. outside of the editor or applying undo, restore, etc.
    async fn update_file(project: ProjectId, file: FileId, text: String) -> Result<SceneGraphDelta>;
    async fn switch_file(project: ProjectId, file: FileId) -> Result<SceneGraph>;
    async fn refresh(project: ProjectId) -> Result<SceneGraph>;
}

pub trait SketchApi {
    async fn new_sketch(
        project: ProjectId,
        file: FileId,
        version: Version,
        args: SketchArgs,
    ) -> Result<(SourceDelta, SceneGraphDelta, ObjectId)>;
    async fn edit_sketch(
        project: ProjectId,
        file: FileId,
        version: Version,
        sketch: ObjectId,
    ) -> Result<SceneGraphDelta>;
    async fn exit_sketch(sketch: ObjectId) -> Result<SceneGraph>;
}

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone)]
pub struct SourceDelta {}

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq)]
pub struct ObjectId(pub usize);

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Ord, PartialOrd)]
pub struct Version(pub usize);

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq)]
pub struct ProjectId(pub usize);

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq)]
pub struct FileId(pub usize);

#[derive(Debug, Clone)]
pub struct File {
    pub id: FileId,
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct Settings {}

#[derive(Debug, Clone)]
pub struct Object {
    pub kind: ObjectKind,
    pub artifact_id: usize,
    pub source: SourceRef,
}

#[derive(Debug, Clone)]
pub enum ObjectKind {
    Sketch(Sketch),
    Segment,
    Constraint,
    Sweep,
}

#[derive(Debug, Clone)]
pub struct Sketch {
    pub args: SketchArgs,
    pub items: Vec<ObjectId>,
}

#[derive(Debug, Clone)]
pub struct SketchArgs {
    pub on: Plane,
}

#[derive(Debug, Clone)]
pub enum Plane {
    Object(ObjectId),
    Default,
}

#[derive(Debug, Clone)]
pub enum SourceRef {
    Simple(SourceRange),
    BackTrace(Vec<SourceRange>),
}

#[derive(Debug, Clone)]
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
}

pub type Result<T> = std::result::Result<T, Error>;
