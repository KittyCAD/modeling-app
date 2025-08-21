//! An API for controlling the KCL interpreter from the frontend.

use kcl_error::SourceRange;

pub trait LifecycleApi {
    fn open_project(project: ProjectId, files: Vec<File>, open_file: FileId) -> Result<SceneGraph>;
    fn add_file(project: ProjectId, file: File) -> Result<SceneGraphDelta>;
    fn remove_file(project: ProjectId, file: FileId) -> Result<SceneGraphDelta>;
    // File changed on disk, etc. outside of the editor or applying undo, restore, etc.
    fn update_file(project: ProjectId, file: FileId, text: String) -> Result<SceneGraphDelta>;
    fn switch_file(project: ProjectId, file: FileId) -> Result<SceneGraph>;
    fn refresh(project: ProjectId) -> Result<SceneGraph>;
}

pub trait SketchApi {
    fn new_sketch(
        project: ProjectId,
        file: FileId,
        version: Version,
        args: SketchArgs,
    ) -> Result<(SourceDelta, SceneGraphDelta, ObjectId)>;
    fn edit_sketch(project: ProjectId, file: FileId, version: Version, sketch: ObjectId) -> Result<SceneGraphDelta>;
    fn exit_sketch(sketch: ObjectId) -> Result<SceneGraph>;
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

#[derive(Debug, Clone)]
pub struct SceneGraphDelta {
    pub new_graph: SceneGraph,
    pub invalidates_ids: bool,
}

#[derive(Debug, Clone)]
pub struct SourceDelta {}

#[derive(Debug, Clone, Copy)]
pub struct ObjectId(pub usize);

#[derive(Debug, Clone, Copy)]
pub struct Version(pub usize);

#[derive(Debug, Clone, Copy)]
pub struct ProjectId(pub usize);

#[derive(Debug, Clone, Copy)]
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

pub type Result<T> = std::result::Result<T, Error>;
