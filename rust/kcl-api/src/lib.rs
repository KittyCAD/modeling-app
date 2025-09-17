//! An API for controlling the KCL interpreter from the frontend.

#![allow(async_fn_in_trait)]

use kcl_error::{CompilationError, SourceRange};
use serde::{Deserialize, Serialize};

pub mod sketch;

pub trait LifecycleApi {
    async fn open_project(&self, project: ProjectId, files: Vec<File>, open_file: FileId) -> Result<()>;
    async fn add_file(&self, project: ProjectId, file: File) -> Result<()>;
    async fn remove_file(&self, project: ProjectId, file: FileId) -> Result<()>;
    // File changed on disk, etc. outside of the editor or applying undo, restore, etc.
    async fn update_file(&self, project: ProjectId, file: FileId, text: String) -> Result<()>;
    async fn switch_file(&self, project: ProjectId, file: FileId) -> Result<()>;
    async fn refresh(&self, project: ProjectId) -> Result<()>;
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
    pub new_objects: Vec<ObjectId>,
    pub invalidates_ids: bool,
}

impl SceneGraphDelta {
    pub fn new(new_graph: SceneGraph, new_objects: Vec<ObjectId>, invalidates_ids: bool) -> Self {
        SceneGraphDelta {
            new_graph,
            new_objects,
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
    pub label: String,
    pub comments: String,
    pub artifact_id: usize,
    pub source: SourceRef,
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub enum ObjectKind {
    Sketch(crate::sketch::Sketch),
    Segment(crate::sketch::Segment),
    Constraint(crate::sketch::Constraint),
    // TODO
    Region,
    Sweep,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub enum Plane {
    Object(ObjectId),
    Default,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
pub enum SourceRef {
    Simple(SourceRange),
    BackTrace(Vec<SourceRange>),
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct Number {
    pub value: f64,
    pub units: NumericSuffix,
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum Expr {
    Number(Number),
    Var(Number),
    Variable(String),
}

// TODO share with kcl-lib
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[repr(u32)]
#[ts(export)]
pub enum NumericSuffix {
    None,
    Count,
    Length,
    Angle,
    Mm,
    Cm,
    M,
    Inch,
    Ft,
    Yd,
    Deg,
    Rad,
    Unknown,
}

impl std::str::FromStr for NumericSuffix {
    type Err = CompilationError;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "_" | "Count" => Ok(NumericSuffix::Count),
            "Length" => Ok(NumericSuffix::Length),
            "Angle" => Ok(NumericSuffix::Angle),
            "mm" | "millimeters" => Ok(NumericSuffix::Mm),
            "cm" | "centimeters" => Ok(NumericSuffix::Cm),
            "m" | "meters" => Ok(NumericSuffix::M),
            "inch" | "in" => Ok(NumericSuffix::Inch),
            "ft" | "feet" => Ok(NumericSuffix::Ft),
            "yd" | "yards" => Ok(NumericSuffix::Yd),
            "deg" | "degrees" => Ok(NumericSuffix::Deg),
            "rad" | "radians" => Ok(NumericSuffix::Rad),
            "?" => Ok(NumericSuffix::Unknown),
            _ => Err(CompilationError::err(SourceRange::default(), "invalid unit of measure")),
        }
    }
}

impl std::fmt::Display for NumericSuffix {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NumericSuffix::None => Ok(()),
            NumericSuffix::Count => write!(f, "_"),
            NumericSuffix::Unknown => write!(f, "_?"),
            NumericSuffix::Length => write!(f, "Length"),
            NumericSuffix::Angle => write!(f, "Angle"),
            NumericSuffix::Mm => write!(f, "mm"),
            NumericSuffix::Cm => write!(f, "cm"),
            NumericSuffix::M => write!(f, "m"),
            NumericSuffix::Inch => write!(f, "in"),
            NumericSuffix::Ft => write!(f, "ft"),
            NumericSuffix::Yd => write!(f, "yd"),
            NumericSuffix::Deg => write!(f, "deg"),
            NumericSuffix::Rad => write!(f, "rad"),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
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
