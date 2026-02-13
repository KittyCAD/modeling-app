//! An API for controlling the KCL interpreter from the frontend.

#![allow(async_fn_in_trait)]

use kcl_error::SourceRange;
use kittycad_modeling_cmds::units::UnitLength;
use serde::{Deserialize, Serialize};

pub use crate::ExecutorSettings as Settings;
use crate::{ExecOutcome, engine::PlaneName, execution::ArtifactId, pretty::NumericSuffix};

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
#[ts(export, export_to = "FrontendApi.ts")]
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
            settings: Default::default(),
            sketch_mode: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct SceneGraphDelta {
    pub new_graph: SceneGraph,
    pub new_objects: Vec<ObjectId>,
    pub invalidates_ids: bool,
    pub exec_outcome: ExecOutcome,
}

impl SceneGraphDelta {
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

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Deserialize, Serialize, ts_rs::TS)]
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

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiObject")]
pub struct Object {
    pub id: ObjectId,
    pub kind: ObjectKind,
    pub label: String,
    pub comments: String,
    pub artifact_id: ArtifactId,
    pub source: SourceRef,
}

impl Object {
    pub fn placeholder(id: ObjectId, range: SourceRange) -> Self {
        Object {
            id,
            kind: ObjectKind::Nil,
            label: Default::default(),
            comments: Default::default(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::Simple { range },
        }
    }
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiObjectKind")]
#[serde(tag = "type")]
pub enum ObjectKind {
    /// A placeholder for an object that will be solved and replaced later.
    Nil,
    Plane(Plane),
    Face(Face),
    Sketch(crate::frontend::sketch::Sketch),
    // These need to be named since the nested types are also enums. ts-rs needs
    // a place to put the type tag.
    Segment {
        segment: crate::frontend::sketch::Segment,
    },
    Constraint {
        constraint: crate::frontend::sketch::Constraint,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiPlane")]
#[serde(rename_all = "camelCase")]
pub enum Plane {
    Object(ObjectId),
    Default(PlaneName),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiFace")]
#[serde(rename_all = "camelCase")]
pub struct Face {
    pub id: ObjectId,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiSourceRef")]
#[serde(tag = "type")]
pub enum SourceRef {
    Simple { range: SourceRange },
    BackTrace { ranges: Vec<SourceRange> },
}

impl From<SourceRange> for SourceRef {
    fn from(value: SourceRange) -> Self {
        Self::Simple { range: value }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Number {
    pub value: f64,
    pub units: NumericSuffix,
}

impl TryFrom<crate::std::args::TyF64> for Number {
    type Error = crate::execution::types::NumericSuffixTypeConvertError;

    fn try_from(value: crate::std::args::TyF64) -> std::result::Result<Self, Self::Error> {
        Ok(Number {
            value: value.n,
            units: value.ty.try_into()?,
        })
    }
}

impl Number {
    pub fn round(&self, digits: u8) -> Self {
        let factor = 10f64.powi(digits as i32);
        let rounded_value = (self.value * factor).round() / factor;
        // Don't return negative zero.
        let value = if rounded_value == -0.0 { 0.0 } else { rounded_value };
        Number {
            value,
            units: self.units,
        }
    }
}

impl From<(f64, UnitLength)> for Number {
    fn from((value, units): (f64, UnitLength)) -> Self {
        // Direct conversion from UnitLength to NumericSuffix (never panics)
        // The From<UnitLength> for NumericSuffix impl is in execution::types
        let units_suffix = NumericSuffix::from(units);
        Number {
            value,
            units: units_suffix,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(tag = "type")]
pub enum Expr {
    Number(Number),
    Var(Number),
    Variable(String),
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
