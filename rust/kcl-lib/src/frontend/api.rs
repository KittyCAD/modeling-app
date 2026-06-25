//! An API for controlling the KCL interpreter from the frontend.

use std::ops::Deref;
use std::ops::DerefMut;

pub use kcl_api::Error;
pub use kcl_api::File;
pub use kcl_api::FileId;
pub use kcl_api::LifecycleApi;
pub use kcl_api::ObjectId;
pub use kcl_api::ProjectId;
pub use kcl_api::Result;
pub use kcl_api::SketchCheckpointId;
pub use kcl_api::SourceDelta;
pub use kcl_api::Version;
use kcl_error::SourceRange;
use kittycad_modeling_cmds::units::UnitLength;
use serde::Deserialize;
use serde::Serialize;

use crate::ExecOutcome;
pub use crate::ExecutorSettings as Settings;
use crate::NodePath;
use crate::engine::PlaneName;
use crate::execution::ArtifactId;
use crate::pretty::NumericSuffix;

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(transparent)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct SceneGraph {
    pub api: kcl_api::SceneGraph<Settings, Object>,
}

impl SceneGraph {
    pub fn empty(project: ProjectId, file: FileId, version: Version) -> Self {
        SceneGraph {
            api: kcl_api::SceneGraph::empty(project, file, version),
        }
    }

    pub fn new(
        project: ProjectId,
        file: FileId,
        version: Version,
        objects: Vec<Object>,
        settings: Settings,
        sketch_mode: Option<ObjectId>,
    ) -> Self {
        SceneGraph {
            api: kcl_api::SceneGraph {
                project,
                file,
                version,
                objects,
                settings,
                sketch_mode,
            },
        }
    }
}

impl Deref for SceneGraph {
    type Target = kcl_api::SceneGraph<Settings, Object>;

    fn deref(&self) -> &Self::Target {
        &self.api
    }
}

impl DerefMut for SceneGraph {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.api
    }
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(transparent)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct SceneGraphDelta {
    pub api: kcl_api::SceneGraphDelta<SceneGraph, ExecOutcome>,
}

impl SceneGraphDelta {
    pub fn new(
        new_graph: SceneGraph,
        new_objects: Vec<ObjectId>,
        invalidates_ids: bool,
        exec_outcome: ExecOutcome,
    ) -> Self {
        SceneGraphDelta {
            api: kcl_api::SceneGraphDelta::new(new_graph, new_objects, invalidates_ids, exec_outcome),
        }
    }
}

impl Deref for SceneGraphDelta {
    type Target = kcl_api::SceneGraphDelta<SceneGraph, ExecOutcome>;

    fn deref(&self) -> &Self::Target {
        &self.api
    }
}

impl DerefMut for SceneGraphDelta {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.api
    }
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(transparent)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct SketchMutationOutcome {
    pub api: kcl_api::SketchMutationOutcome<SceneGraphDelta>,
}

impl SketchMutationOutcome {
    pub fn new(
        source_delta: SourceDelta,
        scene_graph_delta: SceneGraphDelta,
        checkpoint_id: Option<SketchCheckpointId>,
    ) -> Self {
        SketchMutationOutcome {
            api: kcl_api::SketchMutationOutcome {
                source_delta,
                scene_graph_delta,
                checkpoint_id,
            },
        }
    }
}

impl Deref for SketchMutationOutcome {
    type Target = kcl_api::SketchMutationOutcome<SceneGraphDelta>;

    fn deref(&self) -> &Self::Target {
        &self.api
    }
}

impl DerefMut for SketchMutationOutcome {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.api
    }
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(transparent)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct NewSketchOutcome {
    pub api: kcl_api::NewSketchOutcome<SceneGraphDelta>,
}

impl NewSketchOutcome {
    pub fn new(
        source_delta: SourceDelta,
        scene_graph_delta: SceneGraphDelta,
        sketch_id: ObjectId,
        checkpoint_id: Option<SketchCheckpointId>,
    ) -> Self {
        NewSketchOutcome {
            api: kcl_api::NewSketchOutcome {
                source_delta,
                scene_graph_delta,
                sketch_id,
                checkpoint_id,
            },
        }
    }
}

impl Deref for NewSketchOutcome {
    type Target = kcl_api::NewSketchOutcome<SceneGraphDelta>;

    fn deref(&self) -> &Self::Target {
        &self.api
    }
}

impl DerefMut for NewSketchOutcome {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.api
    }
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(transparent)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct EditSketchOutcome {
    pub api: kcl_api::EditSketchOutcome<SceneGraphDelta>,
}

impl EditSketchOutcome {
    pub fn new(scene_graph_delta: SceneGraphDelta, checkpoint_id: Option<SketchCheckpointId>) -> Self {
        EditSketchOutcome {
            api: kcl_api::EditSketchOutcome {
                scene_graph_delta,
                checkpoint_id,
            },
        }
    }
}

impl Deref for EditSketchOutcome {
    type Target = kcl_api::EditSketchOutcome<SceneGraphDelta>;

    fn deref(&self) -> &Self::Target {
        &self.api
    }
}

impl DerefMut for EditSketchOutcome {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.api
    }
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(transparent)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct RestoreSketchCheckpointOutcome {
    pub api: kcl_api::RestoreSketchCheckpointOutcome<SceneGraphDelta>,
}

impl RestoreSketchCheckpointOutcome {
    pub fn new(source_delta: SourceDelta, scene_graph_delta: SceneGraphDelta) -> Self {
        RestoreSketchCheckpointOutcome {
            api: kcl_api::RestoreSketchCheckpointOutcome {
                source_delta,
                scene_graph_delta,
            },
        }
    }
}

impl Deref for RestoreSketchCheckpointOutcome {
    type Target = kcl_api::RestoreSketchCheckpointOutcome<SceneGraphDelta>;

    fn deref(&self) -> &Self::Target {
        &self.api
    }
}

impl DerefMut for RestoreSketchCheckpointOutcome {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.api
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
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
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiObjectKind")]
#[serde(tag = "type")]
pub enum ObjectKind {
    /// A placeholder for an object that will be solved and replaced later.
    Nil,
    Plane(Plane),
    Face(Face),
    Wall(Wall),
    Cap(Cap),
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

impl ObjectKind {
    /// What kind of object is this (point, line, arc, etc)
    /// Suitable for use in user-facing messages.
    pub fn human_friendly_kind_with_article(&self) -> &'static str {
        match self {
            Self::Nil => "a Nil",
            Self::Plane(..) => "a Plane",
            Self::Face(..) => "a Face",
            Self::Wall(..) => "a Wall",
            Self::Cap(..) => "a Cap",
            Self::Sketch(..) => "a Sketch",
            Self::Segment { .. } => "a Segment",
            Self::Constraint { .. } => "a Constraint",
        }
    }
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
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiWall")]
#[serde(rename_all = "camelCase")]
pub struct Wall {
    pub id: ObjectId,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiCap")]
#[serde(rename_all = "camelCase")]
pub struct Cap {
    pub id: ObjectId,
    pub kind: CapKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiCapKind")]
#[serde(rename_all = "camelCase")]
pub enum CapKind {
    Start,
    End,
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
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

impl From<SourceRange> for SourceRef {
    fn from(value: SourceRange) -> Self {
        Self::Simple {
            range: value,
            node_path: None,
        }
    }
}

impl SourceRef {
    pub fn new(range: SourceRange, node_path: Option<NodePath>) -> Self {
        Self::Simple { range, node_path }
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
