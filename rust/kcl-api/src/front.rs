use kcl_error::SourceRange;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::ArtifactId;
use crate::NodePath;
use crate::NumericSuffix;
use crate::UnitLength;
use crate::artifact::PlaneName;

mod sketch;
pub use sketch::*;
mod sketch3d;
pub use sketch3d::*;

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, PartialOrd, Ord, Deserialize, Serialize, JsonSchema, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiObjectId")]
pub struct ObjectId(pub usize);

impl ObjectId {
    pub fn predecessor(self) -> Option<Self> {
        self.0.checked_sub(1).map(ObjectId)
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
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
    pub fn placeholder(id: ObjectId, range: SourceRange, node_path: Option<NodePath>) -> Self {
        Object {
            id,
            kind: ObjectKind::Nil,
            label: Default::default(),
            comments: Default::default(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::new(range, node_path),
        }
    }
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiObjectKind")]
#[serde(tag = "type")]
pub enum ObjectKind {
    /// A placeholder for an object that will be solved and replaced later.
    Nil,
    Plane(Plane),
    Face(Face),
    Wall(Wall),
    Cap(Cap),
    Sketch(crate::front::sketch::Sketch),
    Sketch3d(Sketch3d),
    // These need to be named since the nested types are also enums. ts-rs needs
    // a place to put the type tag.
    Segment {
        segment: sketch::Segment,
    },
    Constraint {
        constraint: sketch::Constraint,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiCap")]
#[serde(rename_all = "camelCase")]
pub struct Cap {
    pub id: ObjectId,
    pub kind: CapKind,
    #[serde(skip_deserializing)]
    pub source: CapSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub solid_output_index: Option<usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiCapSource")]
#[serde(rename_all = "camelCase")]
pub struct CapSource {
    pub solid: SourceRefRange,
    pub sweep: SourceRefRange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiCapKind")]
#[serde(rename_all = "camelCase")]
pub enum CapKind {
    Start,
    End,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiSourceRef")]
#[serde(tag = "type")]
pub enum SourceRef {
    Simple {
        range: SourceRange,
        node_path: Option<NodePath>,
    },
    BackTrace {
        ranges: Vec<(SourceRange, Option<NodePath>)>,
    },
}

impl SourceRef {
    pub fn new(range: SourceRange, node_path: Option<NodePath>) -> Self {
        Self::Simple { range, node_path }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiPlane")]
#[serde(rename_all = "camelCase")]
pub enum Plane {
    Object(ObjectId),
    Default(PlaneName),
    PrimitiveFace(PrimitiveFacePlane),
}

/// An indexed face on a solid which has not yet been materialized as a KCL
/// `Face` value.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(rename_all = "camelCase")]
pub struct PrimitiveFacePlane {
    /// Engine ID of the solid which owns the face.
    pub solid_id: uuid::Uuid,
    pub index: usize,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiFace")]
#[serde(rename_all = "camelCase")]
pub struct Face {
    pub id: ObjectId,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiWall")]
#[serde(rename_all = "camelCase")]
pub struct Wall {
    pub id: ObjectId,
    #[serde(skip_deserializing)]
    pub source: WallSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub solid_output_index: Option<usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiWallSource")]
#[serde(rename_all = "camelCase")]
pub struct WallSource {
    pub solid: SourceRefRange,
    pub sweep: SourceRefRange,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub path: Option<SourceRefRange>,
    pub segment: SourceRefRange,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiSourceRefRange")]
#[serde(rename_all = "camelCase")]
pub struct SourceRefRange {
    pub range: SourceRange,
    pub node_path: Option<NodePath>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct Number {
    pub value: f64,
    pub units: NumericSuffix,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export, export_to = "FrontendApi.ts")]
#[serde(tag = "type")]
pub enum Expr {
    Number(Number),
    Var(Number),
    Variable(String),
}

impl From<SourceRange> for SourceRef {
    fn from(value: SourceRange) -> Self {
        Self::Simple {
            range: value,
            node_path: None,
        }
    }
}

impl From<(f64, UnitLength)> for Number {
    fn from((value, units): (f64, UnitLength)) -> Self {
        // Direct conversion from UnitLength to NumericSuffix (never panics)
        let units_suffix = NumericSuffix::from(units);
        Number {
            value,
            units: units_suffix,
        }
    }
}
