//! The executor for the AST.

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use anyhow::Result;
use async_recursion::async_recursion;
use kcmc::{
    each_cmd as mcmd,
    ok_response::{output::TakeSnapshot, OkModelingCmdResponse},
    websocket::{ModelingSessionData, OkWebSocketResponseData},
    ImageFormat, ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value as JValue;
use tower_lsp::lsp_types::{Position as LspPosition, Range as LspRange};

type Point2D = kcmc::shared::Point2d<f64>;
type Point3D = kcmc::shared::Point3d<f64>;

use crate::{
    ast::types::{
        human_friendly_type, BodyItem, Expr, FunctionExpression, ItemVisibility, KclNone, Node, NodeRef, Program,
        TagDeclarator, TagNode,
    },
    engine::{EngineManager, ExecutionKind},
    errors::{KclError, KclErrorDetails},
    fs::{FileManager, FileSystem},
    settings::types::UnitLength,
    std::{FnAsArg, StdLib},
};

/// State for executing a program.
#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExecState {
    /// Program variable bindings.
    pub memory: ProgramMemory,
    /// The stable artifact ID generator.
    pub id_generator: IdGenerator,
    /// Dynamic state that follows dynamic flow of the program.
    pub dynamic_state: DynamicState,
    /// The current value of the pipe operator returned from the previous
    /// expression.  If we're not currently in a pipeline, this will be None.
    pub pipe_value: Option<KclValue>,
    /// Identifiers that have been exported from the current module.
    pub module_exports: HashSet<String>,
    /// The stack of import statements for detecting circular module imports.
    /// If this is empty, we're not currently executing an import statement.
    pub import_stack: Vec<std::path::PathBuf>,
    /// The directory of the current project.  This is used for resolving import
    /// paths.  If None is given, the current working directory is used.
    pub project_directory: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProgramMemory {
    pub environments: Vec<Environment>,
    pub current_env: EnvironmentRef,
    #[serde(rename = "return")]
    pub return_: Option<KclValue>,
}

impl ProgramMemory {
    pub fn new() -> Self {
        Self {
            environments: vec![Environment::root()],
            current_env: EnvironmentRef::root(),
            return_: None,
        }
    }

    pub fn new_env_for_call(&mut self, parent: EnvironmentRef) -> EnvironmentRef {
        let new_env_ref = EnvironmentRef(self.environments.len());
        let new_env = Environment::new(parent);
        self.environments.push(new_env);
        new_env_ref
    }

    /// Add to the program memory in the current scope.
    pub fn add(&mut self, key: &str, value: KclValue, source_range: SourceRange) -> Result<(), KclError> {
        if self.environments[self.current_env.index()].contains_key(key) {
            return Err(KclError::ValueAlreadyDefined(KclErrorDetails {
                message: format!("Cannot redefine `{}`", key),
                source_ranges: vec![source_range],
            }));
        }

        self.environments[self.current_env.index()].insert(key.to_string(), value);

        Ok(())
    }

    pub fn update_tag(&mut self, tag: &str, value: TagIdentifier) -> Result<(), KclError> {
        self.environments[self.current_env.index()].insert(tag.to_string(), KclValue::TagIdentifier(Box::new(value)));

        Ok(())
    }

    /// Get a value from the program memory.
    /// Return Err if not found.
    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        let mut env_ref = self.current_env;
        loop {
            let env = &self.environments[env_ref.index()];
            if let Some(item) = env.bindings.get(var) {
                return Ok(item);
            }
            if let Some(parent) = env.parent {
                env_ref = parent;
            } else {
                break;
            }
        }

        Err(KclError::UndefinedValue(KclErrorDetails {
            message: format!("memory item key `{}` is not defined", var),
            source_ranges: vec![source_range],
        }))
    }

    /// Find all solids in the memory that are on a specific sketch id.
    /// This does not look inside closures.  But as long as we do not allow
    /// mutation of variables in KCL, closure memory should be a subset of this.
    pub fn find_solids_on_sketch(&self, sketch_id: uuid::Uuid) -> Vec<Box<Solid>> {
        self.environments
            .iter()
            .flat_map(|env| {
                env.bindings
                    .values()
                    .filter_map(|item| match item {
                        KclValue::Solid(eg) if eg.sketch.id == sketch_id => Some(eg.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }
}

impl Default for ProgramMemory {
    fn default() -> Self {
        Self::new()
    }
}

/// An index pointing to an environment.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[schemars(transparent)]
pub struct EnvironmentRef(usize);

impl EnvironmentRef {
    pub fn root() -> Self {
        Self(0)
    }

    pub fn index(&self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
pub struct Environment {
    bindings: HashMap<String, KclValue>,
    parent: Option<EnvironmentRef>,
}

impl Environment {
    pub fn root() -> Self {
        Self {
            // Prelude
            bindings: HashMap::from([
                (
                    "ZERO".to_string(),
                    KclValue::UserVal(UserVal {
                        value: serde_json::Value::Number(serde_json::value::Number::from(0)),
                        meta: Default::default(),
                    }),
                ),
                (
                    "QUARTER_TURN".to_string(),
                    KclValue::UserVal(UserVal {
                        value: serde_json::Value::Number(serde_json::value::Number::from(90)),
                        meta: Default::default(),
                    }),
                ),
                (
                    "HALF_TURN".to_string(),
                    KclValue::UserVal(UserVal {
                        value: serde_json::Value::Number(serde_json::value::Number::from(180)),
                        meta: Default::default(),
                    }),
                ),
                (
                    "THREE_QUARTER_TURN".to_string(),
                    KclValue::UserVal(UserVal {
                        value: serde_json::Value::Number(serde_json::value::Number::from(270)),
                        meta: Default::default(),
                    }),
                ),
            ]),
            parent: None,
        }
    }

    pub fn new(parent: EnvironmentRef) -> Self {
        Self {
            bindings: HashMap::new(),
            parent: Some(parent),
        }
    }

    pub fn get(&self, key: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        self.bindings.get(key).ok_or_else(|| {
            KclError::UndefinedValue(KclErrorDetails {
                message: format!("memory item key `{}` is not defined", key),
                source_ranges: vec![source_range],
            })
        })
    }

    pub fn insert(&mut self, key: String, value: KclValue) {
        self.bindings.insert(key, value);
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.bindings.contains_key(key)
    }

    pub fn update_sketch_tags(&mut self, sg: &Sketch) {
        if sg.tags.is_empty() {
            return;
        }

        for (_, val) in self.bindings.iter_mut() {
            let KclValue::UserVal(v) = val else { continue };
            let meta = v.meta.clone();
            let maybe_sg: Result<Sketch, _> = serde_json::from_value(v.value.clone());
            let Ok(mut sketch) = maybe_sg else {
                continue;
            };

            if sketch.original_id == sg.original_id {
                for tag in sg.tags.iter() {
                    sketch.tags.insert(tag.0.clone(), tag.1.clone());
                }
            }
            *val = KclValue::UserVal(UserVal {
                meta,
                value: serde_json::to_value(sketch).expect("can always turn Sketch into JSON"),
            });
        }
    }
}

/// Dynamic state that depends on the dynamic flow of the program, like the call
/// stack.  If the language had exceptions, for example, you could store the
/// stack of exception handlers here.
#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
pub struct DynamicState {
    pub solid_ids: Vec<SolidLazyIds>,
}

impl DynamicState {
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn merge(&self, memory: &ProgramMemory) -> Self {
        let mut merged = self.clone();
        merged.append(memory);
        merged
    }

    pub fn append(&mut self, memory: &ProgramMemory) {
        for env in &memory.environments {
            for item in env.bindings.values() {
                if let KclValue::Solid(eg) = item {
                    self.solid_ids.push(SolidLazyIds::from(eg.as_ref()));
                }
            }
        }
    }

    pub fn edge_cut_ids_on_sketch(&self, sketch_id: uuid::Uuid) -> Vec<uuid::Uuid> {
        self.solid_ids
            .iter()
            .flat_map(|eg| {
                if eg.sketch_id == sketch_id {
                    eg.edge_cuts.clone()
                } else {
                    Vec::new()
                }
            })
            .collect::<Vec<_>>()
    }
}

/// A generator for ArtifactIds that can be stable across executions.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct IdGenerator {
    next_id: usize,
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

/// Any KCL value.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum KclValue {
    UserVal(UserVal),
    TagIdentifier(Box<TagIdentifier>),
    TagDeclarator(crate::ast::types::BoxNode<TagDeclarator>),
    Plane(Box<Plane>),
    Face(Box<Face>),

    Solid(Box<Solid>),
    Solids {
        value: Vec<Box<Solid>>,
    },
    ImportedGeometry(ImportedGeometry),
    #[ts(skip)]
    Function {
        #[serde(skip)]
        func: Option<MemoryFunction>,
        expression: crate::ast::types::BoxNode<FunctionExpression>,
        memory: Box<ProgramMemory>,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
}

impl KclValue {
    pub(crate) fn new_user_val<T: Serialize>(meta: Vec<Metadata>, val: T) -> Self {
        Self::UserVal(UserVal::new(meta, val))
    }

    pub(crate) fn get_solid_set(&self) -> Result<SolidSet> {
        match self {
            KclValue::Solid(e) => Ok(SolidSet::Solid(e.clone())),
            KclValue::Solids { value } => Ok(SolidSet::Solids(value.clone())),
            KclValue::UserVal(value) => {
                let value = value.value.clone();
                match value {
                    JValue::Null | JValue::Bool(_) | JValue::Number(_) | JValue::String(_) => Err(anyhow::anyhow!(
                        "Failed to deserialize solid set from JSON {}",
                        human_friendly_type(&value)
                    )),
                    JValue::Array(_) => serde_json::from_value::<Vec<Box<Solid>>>(value)
                        .map(SolidSet::from)
                        .map_err(|e| anyhow::anyhow!("Failed to deserialize array of solids from JSON: {}", e)),
                    JValue::Object(_) => serde_json::from_value::<Box<Solid>>(value)
                        .map(SolidSet::from)
                        .map_err(|e| anyhow::anyhow!("Failed to deserialize solid from JSON: {}", e)),
                }
            }
            _ => anyhow::bail!("Not a solid or solids: {:?}", self),
        }
    }

    /// Human readable type name used in error messages.  Should not be relied
    /// on for program logic.
    pub(crate) fn human_friendly_type(&self) -> &'static str {
        match self {
            KclValue::UserVal(u) => human_friendly_type(&u.value),
            KclValue::TagDeclarator(_) => "TagDeclarator",
            KclValue::TagIdentifier(_) => "TagIdentifier",
            KclValue::Solid(_) => "Solid",
            KclValue::Solids { .. } => "Solids",
            KclValue::ImportedGeometry(_) => "ImportedGeometry",
            KclValue::Function { .. } => "Function",
            KclValue::Plane(_) => "Plane",
            KclValue::Face(_) => "Face",
        }
    }

    pub(crate) fn is_function(&self) -> bool {
        match self {
            KclValue::UserVal(..)
            | KclValue::TagIdentifier(..)
            | KclValue::TagDeclarator(..)
            | KclValue::Plane(..)
            | KclValue::Face(..)
            | KclValue::Solid(..)
            | KclValue::Solids { .. }
            | KclValue::ImportedGeometry(..) => false,
            KclValue::Function { .. } => true,
        }
    }
}

impl From<SketchSet> for KclValue {
    fn from(sg: SketchSet) -> Self {
        KclValue::UserVal(UserVal::new(sg.meta(), sg))
    }
}

impl From<Vec<Box<Sketch>>> for KclValue {
    fn from(sg: Vec<Box<Sketch>>) -> Self {
        let meta = sg.iter().flat_map(|sg| sg.meta.clone()).collect();
        KclValue::UserVal(UserVal::new(meta, sg))
    }
}

impl From<SolidSet> for KclValue {
    fn from(eg: SolidSet) -> Self {
        match eg {
            SolidSet::Solid(eg) => KclValue::Solid(eg),
            SolidSet::Solids(egs) => KclValue::Solids { value: egs },
        }
    }
}

impl From<Vec<Box<Solid>>> for KclValue {
    fn from(eg: Vec<Box<Solid>>) -> Self {
        if eg.len() == 1 {
            KclValue::Solid(eg[0].clone())
        } else {
            KclValue::Solids { value: eg }
        }
    }
}

/// A geometry.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Geometry {
    Sketch(Box<Sketch>),
    Solid(Box<Solid>),
}

impl Geometry {
    pub fn id(&self) -> uuid::Uuid {
        match self {
            Geometry::Sketch(s) => s.id,
            Geometry::Solid(e) => e.id,
        }
    }
}

/// A set of geometry.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Geometries {
    Sketches(Vec<Box<Sketch>>),
    Solids(Vec<Box<Solid>>),
}

impl From<Geometry> for Geometries {
    fn from(value: Geometry) -> Self {
        match value {
            Geometry::Sketch(x) => Self::Sketches(vec![x]),
            Geometry::Solid(x) => Self::Solids(vec![x]),
        }
    }
}

/// A sketch or a group of sketches.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SketchSet {
    Sketch(Box<Sketch>),
    Sketches(Vec<Box<Sketch>>),
}

impl SketchSet {
    pub fn meta(&self) -> Vec<Metadata> {
        match self {
            SketchSet::Sketch(sg) => sg.meta.clone(),
            SketchSet::Sketches(sg) => sg.iter().flat_map(|sg| sg.meta.clone()).collect(),
        }
    }
}

impl From<SketchSet> for Vec<Sketch> {
    fn from(value: SketchSet) -> Self {
        match value {
            SketchSet::Sketch(sg) => vec![*sg],
            SketchSet::Sketches(sgs) => sgs.into_iter().map(|sg| *sg).collect(),
        }
    }
}

impl From<Sketch> for SketchSet {
    fn from(sg: Sketch) -> Self {
        SketchSet::Sketch(Box::new(sg))
    }
}

impl From<Box<Sketch>> for SketchSet {
    fn from(sg: Box<Sketch>) -> Self {
        SketchSet::Sketch(sg)
    }
}

impl From<Vec<Sketch>> for SketchSet {
    fn from(sg: Vec<Sketch>) -> Self {
        if sg.len() == 1 {
            SketchSet::Sketch(Box::new(sg[0].clone()))
        } else {
            SketchSet::Sketches(sg.into_iter().map(Box::new).collect())
        }
    }
}

impl From<Vec<Box<Sketch>>> for SketchSet {
    fn from(sg: Vec<Box<Sketch>>) -> Self {
        if sg.len() == 1 {
            SketchSet::Sketch(sg[0].clone())
        } else {
            SketchSet::Sketches(sg)
        }
    }
}

impl From<SketchSet> for Vec<Box<Sketch>> {
    fn from(sg: SketchSet) -> Self {
        match sg {
            SketchSet::Sketch(sg) => vec![sg],
            SketchSet::Sketches(sgs) => sgs,
        }
    }
}

impl From<&Sketch> for Vec<Box<Sketch>> {
    fn from(sg: &Sketch) -> Self {
        vec![Box::new(sg.clone())]
    }
}

impl From<Box<Sketch>> for Vec<Box<Sketch>> {
    fn from(sg: Box<Sketch>) -> Self {
        vec![sg]
    }
}

/// A solid or a group of solids.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SolidSet {
    Solid(Box<Solid>),
    Solids(Vec<Box<Solid>>),
}

impl From<Solid> for SolidSet {
    fn from(eg: Solid) -> Self {
        SolidSet::Solid(Box::new(eg))
    }
}

impl From<Box<Solid>> for SolidSet {
    fn from(eg: Box<Solid>) -> Self {
        SolidSet::Solid(eg)
    }
}

impl From<Vec<Solid>> for SolidSet {
    fn from(eg: Vec<Solid>) -> Self {
        if eg.len() == 1 {
            SolidSet::Solid(Box::new(eg[0].clone()))
        } else {
            SolidSet::Solids(eg.into_iter().map(Box::new).collect())
        }
    }
}

impl From<Vec<Box<Solid>>> for SolidSet {
    fn from(eg: Vec<Box<Solid>>) -> Self {
        if eg.len() == 1 {
            SolidSet::Solid(eg[0].clone())
        } else {
            SolidSet::Solids(eg)
        }
    }
}

impl From<SolidSet> for Vec<Box<Solid>> {
    fn from(eg: SolidSet) -> Self {
        match eg {
            SolidSet::Solid(eg) => vec![eg],
            SolidSet::Solids(egs) => egs,
        }
    }
}

impl From<&Solid> for Vec<Box<Solid>> {
    fn from(eg: &Solid) -> Self {
        vec![Box::new(eg.clone())]
    }
}

impl From<Box<Solid>> for Vec<Box<Solid>> {
    fn from(eg: Box<Solid>) -> Self {
        vec![eg]
    }
}

/// Data for an imported geometry.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGeometry {
    /// The ID of the imported geometry.
    pub id: uuid::Uuid,
    /// The original file paths.
    pub value: Vec<String>,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

/// A plane.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Plane {
    /// The id of the plane.
    pub id: uuid::Uuid,
    // The code for the plane either a string or custom.
    pub value: PlaneType,
    /// Origin of the plane.
    pub origin: Point3d,
    /// What should the plane’s X axis be?
    pub x_axis: Point3d,
    /// What should the plane’s Y axis be?
    pub y_axis: Point3d,
    /// The z-axis (normal).
    pub z_axis: Point3d,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

impl Plane {
    pub(crate) fn from_plane_data(value: crate::std::sketch::PlaneData, exec_state: &mut ExecState) -> Self {
        let id = exec_state.id_generator.next_uuid();
        match value {
            crate::std::sketch::PlaneData::XY => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 1.0, 0.0),
                z_axis: Point3d::new(0.0, 0.0, 1.0),
                value: PlaneType::XY,
                meta: vec![],
            },
            crate::std::sketch::PlaneData::NegXY => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 1.0, 0.0),
                z_axis: Point3d::new(0.0, 0.0, -1.0),
                value: PlaneType::XY,
                meta: vec![],
            },
            crate::std::sketch::PlaneData::XZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(0.0, -1.0, 0.0),
                value: PlaneType::XZ,
                meta: vec![],
            },
            crate::std::sketch::PlaneData::NegXZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(-1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(0.0, 1.0, 0.0),
                value: PlaneType::XZ,
                meta: vec![],
            },
            crate::std::sketch::PlaneData::YZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(0.0, 1.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(1.0, 0.0, 0.0),
                value: PlaneType::YZ,
                meta: vec![],
            },
            crate::std::sketch::PlaneData::NegYZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(0.0, 1.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(-1.0, 0.0, 0.0),
                value: PlaneType::YZ,
                meta: vec![],
            },
            crate::std::sketch::PlaneData::Plane {
                origin,
                x_axis,
                y_axis,
                z_axis,
            } => Plane {
                id,
                origin: *origin,
                x_axis: *x_axis,
                y_axis: *y_axis,
                z_axis: *z_axis,
                value: PlaneType::Custom,
                meta: vec![],
            },
        }
    }
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

/// A face.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    /// The id of the face.
    pub id: uuid::Uuid,
    /// The tag of the face.
    pub value: String,
    /// What should the face’s X axis be?
    pub x_axis: Point3d,
    /// What should the face’s Y axis be?
    pub y_axis: Point3d,
    /// The z-axis (normal).
    pub z_axis: Point3d,
    /// The solid the face is on.
    pub solid: Box<Solid>,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

/// Type for a plane.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
#[display(style = "camelCase")]
pub enum PlaneType {
    #[serde(rename = "XY", alias = "xy")]
    #[display("XY")]
    XY,
    #[serde(rename = "XZ", alias = "xz")]
    #[display("XZ")]
    XZ,
    #[serde(rename = "YZ", alias = "yz")]
    #[display("YZ")]
    YZ,
    /// A custom plane.
    #[serde(rename = "Custom")]
    #[display("Custom")]
    Custom,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct UserVal {
    #[ts(type = "any")]
    pub value: serde_json::Value,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

impl UserVal {
    pub fn new<T: serde::Serialize>(meta: Vec<Metadata>, val: T) -> Self {
        Self {
            meta,
            value: serde_json::to_value(val).expect("all KCL values should be compatible with JSON"),
        }
    }

    /// If the UserVal matches the type `T`, return it.
    pub fn get<T: serde::de::DeserializeOwned>(&self) -> Option<(T, Vec<Metadata>)> {
        let meta = self.meta.clone();
        // TODO: This clone might cause performance problems, it'll happen a lot.
        let res: Result<T, _> = serde_json::from_value(self.value.clone());
        if let Ok(t) = res {
            Some((t, meta))
        } else {
            None
        }
    }

    /// If the UserVal matches the type `T`, then mutate it via the given closure.
    /// If the closure returns Err, the mutation won't be applied.
    pub fn mutate<T, F, E>(&mut self, mutate: F) -> Result<(), E>
    where
        T: serde::de::DeserializeOwned + Serialize,
        F: FnOnce(&mut T) -> Result<(), E>,
    {
        let Some((mut val, meta)) = self.get::<T>() else {
            return Ok(());
        };
        mutate(&mut val)?;
        *self = Self::new(meta, val);
        Ok(())
    }
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
        s: Vec<KclValue>,
        memory: ProgramMemory,
        expression: crate::ast::types::BoxNode<FunctionExpression>,
        metadata: Vec<Metadata>,
        exec_state: &ExecState,
        ctx: ExecutorContext,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Option<KclValue>, KclError>> + Send>>;

impl From<KclValue> for Vec<SourceRange> {
    fn from(item: KclValue) -> Self {
        match item {
            KclValue::UserVal(u) => u.meta.iter().map(|m| m.source_range).collect(),
            KclValue::TagDeclarator(t) => vec![(&t).into()],
            KclValue::TagIdentifier(t) => t.meta.iter().map(|m| m.source_range).collect(),
            KclValue::Solid(e) => e.meta.iter().map(|m| m.source_range).collect(),
            KclValue::Solids { value } => value
                .iter()
                .flat_map(|eg| eg.meta.iter().map(|m| m.source_range))
                .collect(),
            KclValue::ImportedGeometry(i) => i.meta.iter().map(|m| m.source_range).collect(),
            KclValue::Function { meta, .. } => meta.iter().map(|m| m.source_range).collect(),
            KclValue::Plane(p) => p.meta.iter().map(|m| m.source_range).collect(),
            KclValue::Face(f) => f.meta.iter().map(|m| m.source_range).collect(),
        }
    }
}

impl From<&KclValue> for Vec<SourceRange> {
    fn from(item: &KclValue) -> Self {
        match item {
            KclValue::UserVal(u) => u.meta.iter().map(|m| m.source_range).collect(),
            KclValue::TagDeclarator(ref t) => vec![t.into()],
            KclValue::TagIdentifier(t) => t.meta.iter().map(|m| m.source_range).collect(),
            KclValue::Solid(e) => e.meta.iter().map(|m| m.source_range).collect(),
            KclValue::Solids { value } => value
                .iter()
                .flat_map(|eg| eg.meta.iter().map(|m| m.source_range))
                .collect(),
            KclValue::ImportedGeometry(i) => i.meta.iter().map(|m| m.source_range).collect(),
            KclValue::Function { meta, .. } => meta.iter().map(|m| m.source_range).collect(),
            KclValue::Plane(p) => p.meta.iter().map(|m| m.source_range).collect(),
            KclValue::Face(f) => f.meta.iter().map(|m| m.source_range).collect(),
        }
    }
}

impl KclValue {
    pub fn get_json_value(&self) -> Result<serde_json::Value, KclError> {
        if let KclValue::UserVal(user_val) = self {
            Ok(user_val.value.clone())
        } else {
            serde_json::to_value(self).map_err(|err| {
                KclError::Semantic(KclErrorDetails {
                    message: format!("Cannot convert memory item to json value: {:?}", err),
                    source_ranges: self.clone().into(),
                })
            })
        }
    }

    /// Get a JSON value and deserialize it into some concrete type.
    pub fn get_json<T: serde::de::DeserializeOwned>(&self) -> Result<T, KclError> {
        let json = self.get_json_value()?;

        serde_json::from_value(json).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to deserialize struct from JSON: {}", e),
                source_ranges: self.clone().into(),
            })
        })
    }

    /// Get a JSON value and deserialize it into some concrete type.
    /// If it's a KCL None, return None. Otherwise return Some.
    pub fn get_json_opt<T: serde::de::DeserializeOwned>(&self) -> Result<Option<T>, KclError> {
        let json = self.get_json_value()?;
        if let JValue::Object(ref o) = json {
            if let Some(JValue::String(s)) = o.get("type") {
                if s == "KclNone" {
                    return Ok(None);
                }
            }
        }

        serde_json::from_value(json)
            .map_err(|e| {
                KclError::Type(KclErrorDetails {
                    message: format!("Failed to deserialize struct from JSON: {}", e),
                    source_ranges: self.clone().into(),
                })
            })
            .map(Some)
    }

    pub fn as_user_val(&self) -> Option<&UserVal> {
        if let KclValue::UserVal(x) = self {
            Some(x)
        } else {
            None
        }
    }

    /// If this value is of type u32, return it.
    pub fn get_u32(&self, source_ranges: Vec<SourceRange>) -> Result<u32, KclError> {
        let err = KclError::Semantic(KclErrorDetails {
            message: "Expected an integer >= 0".to_owned(),
            source_ranges,
        });
        self.as_user_val()
            .and_then(|uv| uv.value.as_number())
            .and_then(|n| n.as_u64())
            .and_then(|n| u32::try_from(n).ok())
            .ok_or(err)
    }

    /// If this value is of type function, return it.
    pub fn get_function(&self) -> Option<FnAsArg<'_>> {
        let KclValue::Function {
            func,
            expression,
            memory,
            meta: _,
        } = &self
        else {
            return None;
        };
        Some(FnAsArg {
            func: func.as_ref(),
            expr: expression.to_owned(),
            memory: memory.to_owned(),
        })
    }

    /// Get a tag identifier from a memory item.
    pub fn get_tag_identifier(&self) -> Result<TagIdentifier, KclError> {
        match self {
            KclValue::TagIdentifier(t) => Ok(*t.clone()),
            KclValue::UserVal(_) => {
                if let Some(identifier) = self.get_json_opt::<TagIdentifier>()? {
                    Ok(identifier)
                } else {
                    Err(KclError::Semantic(KclErrorDetails {
                        message: format!("Not a tag identifier: {:?}", self),
                        source_ranges: self.clone().into(),
                    }))
                }
            }
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: format!("Not a tag identifier: {:?}", self),
                source_ranges: self.clone().into(),
            })),
        }
    }

    /// Get a tag declarator from a memory item.
    pub fn get_tag_declarator(&self) -> Result<TagNode, KclError> {
        match self {
            KclValue::TagDeclarator(t) => Ok((**t).clone()),
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: format!("Not a tag declarator: {:?}", self),
                source_ranges: self.clone().into(),
            })),
        }
    }

    /// Get an optional tag from a memory item.
    pub fn get_tag_declarator_opt(&self) -> Result<Option<TagNode>, KclError> {
        match self {
            KclValue::TagDeclarator(t) => Ok(Some((**t).clone())),
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: format!("Not a tag declarator: {:?}", self),
                source_ranges: self.clone().into(),
            })),
        }
    }

    /// If this KCL value is a bool, retrieve it.
    pub fn get_bool(&self) -> Result<bool, KclError> {
        let Self::UserVal(uv) = self else {
            return Err(KclError::Type(KclErrorDetails {
                source_ranges: self.into(),
                message: format!("Expected bool, found {}", self.human_friendly_type()),
            }));
        };
        let JValue::Bool(b) = uv.value else {
            return Err(KclError::Type(KclErrorDetails {
                source_ranges: self.into(),
                message: format!("Expected bool, found {}", human_friendly_type(&uv.value)),
            }));
        };
        Ok(b)
    }

    /// If this memory item is a function, call it with the given arguments, return its val as Ok.
    /// If it's not a function, return Err.
    pub async fn call_fn(
        &self,
        args: Vec<KclValue>,
        exec_state: &mut ExecState,
        ctx: ExecutorContext,
    ) -> Result<Option<KclValue>, KclError> {
        let KclValue::Function {
            func,
            expression,
            memory: closure_memory,
            meta,
        } = &self
        else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "not a in memory function".to_string(),
                source_ranges: vec![],
            }));
        };
        if let Some(func) = func {
            func(
                args,
                closure_memory.as_ref().clone(),
                expression.clone(),
                meta.clone(),
                exec_state,
                ctx,
            )
            .await
        } else {
            call_user_defined_function(args, closure_memory.as_ref(), expression.as_ref(), exec_state, &ctx).await
        }
    }
}

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

/// A sketch is a collection of paths.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct Sketch {
    /// The id of the sketch (this will change when the engine's reference to it changes).
    pub id: uuid::Uuid,
    /// The paths in the sketch.
    pub paths: Vec<Path>,
    /// What the sketch is on (can be a plane or a face).
    pub on: SketchSurface,
    /// The starting path.
    pub start: BasePath,
    /// Tag identifiers that have been declared in this sketch.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub tags: HashMap<String, TagIdentifier>,
    /// The original id of the sketch. This stays the same even if the sketch is
    /// is sketched on face etc.
    #[serde(skip)]
    pub original_id: uuid::Uuid,
    /// Metadata.
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

/// A sketch type.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SketchSurface {
    Plane(Box<Plane>),
    Face(Box<Face>),
}

impl SketchSurface {
    pub(crate) fn id(&self) -> uuid::Uuid {
        match self {
            SketchSurface::Plane(plane) => plane.id,
            SketchSurface::Face(face) => face.id,
        }
    }
    pub(crate) fn x_axis(&self) -> Point3d {
        match self {
            SketchSurface::Plane(plane) => plane.x_axis,
            SketchSurface::Face(face) => face.x_axis,
        }
    }
    pub(crate) fn y_axis(&self) -> Point3d {
        match self {
            SketchSurface::Plane(plane) => plane.y_axis,
            SketchSurface::Face(face) => face.y_axis,
        }
    }
    pub(crate) fn z_axis(&self) -> Point3d {
        match self {
            SketchSurface::Plane(plane) => plane.z_axis,
            SketchSurface::Face(face) => face.z_axis,
        }
    }
}

pub struct GetTangentialInfoFromPathsResult {
    pub center_or_tangent_point: [f64; 2],
    pub is_center: bool,
    pub ccw: bool,
}

impl Sketch {
    pub(crate) fn add_tag(&mut self, tag: NodeRef<'_, TagDeclarator>, current_path: &Path) {
        let mut tag_identifier: TagIdentifier = tag.into();
        let base = current_path.get_base();
        tag_identifier.info = Some(TagEngineInfo {
            id: base.geo_meta.id,
            sketch: self.id,
            path: Some(current_path.clone()),
            surface: None,
        });

        self.tags.insert(tag.name.to_string(), tag_identifier);
    }

    /// Get the path most recently sketched.
    pub(crate) fn latest_path(&self) -> Option<&Path> {
        self.paths.last()
    }

    /// The "pen" is an imaginary pen drawing the path.
    /// This gets the current point the pen is hovering over, i.e. the point
    /// where the last path segment ends, and the next path segment will begin.
    pub(crate) fn current_pen_position(&self) -> Result<Point2d, KclError> {
        let Some(path) = self.latest_path() else {
            return Ok(self.start.to.into());
        };

        let base = path.get_base();
        Ok(base.to.into())
    }

    pub(crate) fn get_tangential_info_from_paths(&self) -> GetTangentialInfoFromPathsResult {
        let Some(path) = self.latest_path() else {
            return GetTangentialInfoFromPathsResult {
                center_or_tangent_point: self.start.to,
                is_center: false,
                ccw: false,
            };
        };
        match path {
            Path::TangentialArc { center, ccw, .. } => GetTangentialInfoFromPathsResult {
                center_or_tangent_point: *center,
                is_center: true,
                ccw: *ccw,
            },
            Path::TangentialArcTo { center, ccw, .. } => GetTangentialInfoFromPathsResult {
                center_or_tangent_point: *center,
                is_center: true,
                ccw: *ccw,
            },
            _ => {
                let base = path.get_base();
                GetTangentialInfoFromPathsResult {
                    center_or_tangent_point: base.from,
                    is_center: false,
                    ccw: false,
                }
            }
        }
    }
}

/// An solid is a collection of extrude surfaces.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct Solid {
    /// The id of the solid.
    pub id: uuid::Uuid,
    /// The extrude surfaces.
    pub value: Vec<ExtrudeSurface>,
    /// The sketch.
    pub sketch: Sketch,
    /// The height of the solid.
    pub height: f64,
    /// The id of the extrusion start cap
    pub start_cap_id: Option<uuid::Uuid>,
    /// The id of the extrusion end cap
    pub end_cap_id: Option<uuid::Uuid>,
    /// Chamfers or fillets on this solid.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cuts: Vec<EdgeCut>,
    /// Metadata.
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

impl Solid {
    pub(crate) fn get_all_edge_cut_ids(&self) -> Vec<uuid::Uuid> {
        self.edge_cuts.iter().map(|foc| foc.id()).collect()
    }
}

/// An solid ID and its fillet and chamfer IDs.  This is needed for lazy
/// fillet evaluation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
pub struct SolidLazyIds {
    pub solid_id: uuid::Uuid,
    pub sketch_id: uuid::Uuid,
    /// Chamfers or fillets on this solid.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cuts: Vec<uuid::Uuid>,
}

impl From<&Solid> for SolidLazyIds {
    fn from(eg: &Solid) -> Self {
        Self {
            solid_id: eg.id,
            sketch_id: eg.sketch.id,
            edge_cuts: eg.edge_cuts.iter().map(|foc| foc.id()).collect(),
        }
    }
}

/// A fillet or a chamfer.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EdgeCut {
    /// A fillet.
    Fillet {
        /// The id of the engine command that called this fillet.
        id: uuid::Uuid,
        radius: f64,
        /// The engine id of the edge to fillet.
        #[serde(rename = "edgeId")]
        edge_id: uuid::Uuid,
        tag: Box<Option<TagNode>>,
    },
    /// A chamfer.
    Chamfer {
        /// The id of the engine command that called this chamfer.
        id: uuid::Uuid,
        length: f64,
        /// The engine id of the edge to chamfer.
        #[serde(rename = "edgeId")]
        edge_id: uuid::Uuid,
        tag: Box<Option<TagNode>>,
    },
}

impl EdgeCut {
    pub fn id(&self) -> uuid::Uuid {
        match self {
            EdgeCut::Fillet { id, .. } => *id,
            EdgeCut::Chamfer { id, .. } => *id,
        }
    }

    pub fn edge_id(&self) -> uuid::Uuid {
        match self {
            EdgeCut::Fillet { edge_id, .. } => *edge_id,
            EdgeCut::Chamfer { edge_id, .. } => *edge_id,
        }
    }

    pub fn tag(&self) -> Option<TagNode> {
        match self {
            EdgeCut::Fillet { tag, .. } => *tag.clone(),
            EdgeCut::Chamfer { tag, .. } => *tag.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum BodyType {
    Root,
    Sketch,
    Block,
}

#[derive(Debug, Default, Deserialize, Serialize, PartialEq, Copy, Clone, ts_rs::TS, JsonSchema, Hash, Eq)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass)]
#[ts(export)]
pub struct SourceRange(#[ts(type = "[number, number]")] pub [usize; 2]);

impl From<[usize; 2]> for SourceRange {
    fn from(value: [usize; 2]) -> Self {
        Self(value)
    }
}

impl SourceRange {
    /// Create a new source range.
    pub fn new(start: usize, end: usize) -> Self {
        Self([start, end])
    }

    /// Get the start of the range.
    pub fn start(&self) -> usize {
        self.0[0]
    }

    /// Get the end of the range.
    pub fn end(&self) -> usize {
        self.0[1]
    }

    /// Check if the range contains a position.
    pub fn contains(&self, pos: usize) -> bool {
        pos >= self.start() && pos <= self.end()
    }

    pub fn start_to_lsp_position(&self, code: &str) -> LspPosition {
        // Calculate the line and column of the error from the source range.
        // Lines are zero indexed in vscode so we need to subtract 1.
        let mut line = code.get(..self.start()).unwrap_or_default().lines().count();
        if line > 0 {
            line = line.saturating_sub(1);
        }
        let column = code[..self.start()].lines().last().map(|l| l.len()).unwrap_or_default();

        LspPosition {
            line: line as u32,
            character: column as u32,
        }
    }

    pub fn end_to_lsp_position(&self, code: &str) -> LspPosition {
        let lines = code.get(..self.end()).unwrap_or_default().lines();
        if lines.clone().count() == 0 {
            return LspPosition { line: 0, character: 0 };
        }

        // Calculate the line and column of the error from the source range.
        // Lines are zero indexed in vscode so we need to subtract 1.
        let line = lines.clone().count() - 1;
        let column = lines.last().map(|l| l.len()).unwrap_or_default();

        LspPosition {
            line: line as u32,
            character: column as u32,
        }
    }

    pub fn to_lsp_range(&self, code: &str) -> LspRange {
        let start = self.start_to_lsp_position(code);
        let end = self.end_to_lsp_position(code);
        LspRange { start, end }
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Clone, Copy, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct Point2d {
    pub x: f64,
    pub y: f64,
}

impl From<[f64; 2]> for Point2d {
    fn from(p: [f64; 2]) -> Self {
        Self { x: p[0], y: p[1] }
    }
}

impl From<&[f64; 2]> for Point2d {
    fn from(p: &[f64; 2]) -> Self {
        Self { x: p[0], y: p[1] }
    }
}

impl From<Point2d> for [f64; 2] {
    fn from(p: Point2d) -> Self {
        [p.x, p.y]
    }
}

impl From<Point2d> for Point2D {
    fn from(p: Point2d) -> Self {
        Self { x: p.x, y: p.y }
    }
}

impl Point2d {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };
    pub fn scale(self, scalar: f64) -> Self {
        Self {
            x: self.x * scalar,
            y: self.y * scalar,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Clone, Copy, ts_rs::TS, JsonSchema, Default)]
#[ts(export)]
pub struct Point3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point3d {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0, z: 0.0 };
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
}

impl From<Point3d> for Point3D {
    fn from(p: Point3d) -> Self {
        Self { x: p.x, y: p.y, z: p.z }
    }
}
impl From<Point3d> for kittycad_modeling_cmds::shared::Point3d<LengthUnit> {
    fn from(p: Point3d) -> Self {
        Self {
            x: LengthUnit(p.x),
            y: LengthUnit(p.y),
            z: LengthUnit(p.z),
        }
    }
}

/// Metadata.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    /// The source range.
    pub source_range: SourceRange,
}

impl From<SourceRange> for Metadata {
    fn from(source_range: SourceRange) -> Self {
        Self { source_range }
    }
}

impl<T> From<NodeRef<'_, T>> for Metadata {
    fn from(node: NodeRef<'_, T>) -> Self {
        Self {
            source_range: SourceRange::new(node.start, node.end),
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

/// A base path.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BasePath {
    /// The from point.
    #[ts(type = "[number, number]")]
    pub from: [f64; 2],
    /// The to point.
    #[ts(type = "[number, number]")]
    pub to: [f64; 2],
    /// The tag of the path.
    pub tag: Option<TagNode>,
    /// Metadata.
    #[serde(rename = "__geoMeta")]
    pub geo_meta: GeoMeta,
}

/// Geometry metadata.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GeoMeta {
    /// The id of the geometry.
    pub id: uuid::Uuid,
    /// Metadata.
    #[serde(flatten)]
    pub metadata: Metadata,
}

/// A path.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Path {
    /// A path that goes to a point.
    ToPoint {
        #[serde(flatten)]
        base: BasePath,
    },
    /// A arc that is tangential to the last path segment that goes to a point
    TangentialArcTo {
        #[serde(flatten)]
        base: BasePath,
        /// the arc's center
        #[ts(type = "[number, number]")]
        center: [f64; 2],
        /// arc's direction
        ccw: bool,
    },
    /// A arc that is tangential to the last path segment
    TangentialArc {
        #[serde(flatten)]
        base: BasePath,
        /// the arc's center
        #[ts(type = "[number, number]")]
        center: [f64; 2],
        /// arc's direction
        ccw: bool,
    },
    // TODO: consolidate segment enums, remove Circle. https://github.com/KittyCAD/modeling-app/issues/3940
    /// a complete arc
    Circle {
        #[serde(flatten)]
        base: BasePath,
        /// the arc's center
        #[ts(type = "[number, number]")]
        center: [f64; 2],
        /// the arc's radius
        radius: f64,
        /// arc's direction
        // Maybe this one's not needed since it's a full revolution?
        ccw: bool,
    },
    /// A path that is horizontal.
    Horizontal {
        #[serde(flatten)]
        base: BasePath,
        /// The x coordinate.
        x: f64,
    },
    /// An angled line to.
    AngledLineTo {
        #[serde(flatten)]
        base: BasePath,
        /// The x coordinate.
        x: Option<f64>,
        /// The y coordinate.
        y: Option<f64>,
    },
    /// A base path.
    Base {
        #[serde(flatten)]
        base: BasePath,
    },
    /// A circular arc, not necessarily tangential to the current point.
    Arc {
        #[serde(flatten)]
        base: BasePath,
        /// Center of the circle that this arc is drawn on.
        center: [f64; 2],
        /// Radius of the circle that this arc is drawn on.
        radius: f64,
    },
}

/// What kind of path is this?
#[derive(Display)]
enum PathType {
    ToPoint,
    Base,
    TangentialArc,
    TangentialArcTo,
    Circle,
    Horizontal,
    AngledLineTo,
    Arc,
}

impl From<&Path> for PathType {
    fn from(value: &Path) -> Self {
        match value {
            Path::ToPoint { .. } => Self::ToPoint,
            Path::TangentialArcTo { .. } => Self::TangentialArcTo,
            Path::TangentialArc { .. } => Self::TangentialArc,
            Path::Circle { .. } => Self::Circle,
            Path::Horizontal { .. } => Self::Horizontal,
            Path::AngledLineTo { .. } => Self::AngledLineTo,
            Path::Base { .. } => Self::Base,
            Path::Arc { .. } => Self::Arc,
        }
    }
}

impl Path {
    pub fn get_id(&self) -> uuid::Uuid {
        match self {
            Path::ToPoint { base } => base.geo_meta.id,
            Path::Horizontal { base, .. } => base.geo_meta.id,
            Path::AngledLineTo { base, .. } => base.geo_meta.id,
            Path::Base { base } => base.geo_meta.id,
            Path::TangentialArcTo { base, .. } => base.geo_meta.id,
            Path::TangentialArc { base, .. } => base.geo_meta.id,
            Path::Circle { base, .. } => base.geo_meta.id,
            Path::Arc { base, .. } => base.geo_meta.id,
        }
    }

    pub fn get_tag(&self) -> Option<TagNode> {
        match self {
            Path::ToPoint { base } => base.tag.clone(),
            Path::Horizontal { base, .. } => base.tag.clone(),
            Path::AngledLineTo { base, .. } => base.tag.clone(),
            Path::Base { base } => base.tag.clone(),
            Path::TangentialArcTo { base, .. } => base.tag.clone(),
            Path::TangentialArc { base, .. } => base.tag.clone(),
            Path::Circle { base, .. } => base.tag.clone(),
            Path::Arc { base, .. } => base.tag.clone(),
        }
    }

    pub fn get_base(&self) -> &BasePath {
        match self {
            Path::ToPoint { base } => base,
            Path::Horizontal { base, .. } => base,
            Path::AngledLineTo { base, .. } => base,
            Path::Base { base } => base,
            Path::TangentialArcTo { base, .. } => base,
            Path::TangentialArc { base, .. } => base,
            Path::Circle { base, .. } => base,
            Path::Arc { base, .. } => base,
        }
    }

    /// Where does this path segment start?
    pub fn get_from(&self) -> &[f64; 2] {
        &self.get_base().from
    }
    /// Where does this path segment end?
    pub fn get_to(&self) -> &[f64; 2] {
        &self.get_base().to
    }

    /// Length of this path segment, in cartesian plane.
    pub fn length(&self) -> f64 {
        match self {
            Self::ToPoint { .. } | Self::Base { .. } | Self::Horizontal { .. } | Self::AngledLineTo { .. } => {
                linear_distance(self.get_from(), self.get_to())
            }
            Self::TangentialArc {
                base: _,
                center,
                ccw: _,
            }
            | Self::TangentialArcTo {
                base: _,
                center,
                ccw: _,
            } => {
                // The radius can be calculated as the linear distance between `to` and `center`,
                // or between `from` and `center`. They should be the same.
                let radius = linear_distance(self.get_from(), center);
                debug_assert_eq!(radius, linear_distance(self.get_to(), center));
                // TODO: Call engine utils to figure this out.
                linear_distance(self.get_from(), self.get_to())
            }
            Self::Circle { radius, .. } => 2.0 * std::f64::consts::PI * radius,
            Self::Arc { .. } => {
                // TODO: Call engine utils to figure this out.
                linear_distance(self.get_from(), self.get_to())
            }
        }
    }

    pub fn get_base_mut(&mut self) -> Option<&mut BasePath> {
        match self {
            Path::ToPoint { base } => Some(base),
            Path::Horizontal { base, .. } => Some(base),
            Path::AngledLineTo { base, .. } => Some(base),
            Path::Base { base } => Some(base),
            Path::TangentialArcTo { base, .. } => Some(base),
            Path::TangentialArc { base, .. } => Some(base),
            Path::Circle { base, .. } => Some(base),
            Path::Arc { base, .. } => Some(base),
        }
    }
}

/// Compute the straight-line distance between a pair of (2D) points.
#[rustfmt::skip]
fn linear_distance(
    [x0, y0]: &[f64; 2],
    [x1, y1]: &[f64; 2]
) -> f64 {
    let y_sq = (y1 - y0).powi(2);
    let x_sq = (x1 - x0).powi(2);
    (y_sq + x_sq).sqrt()
}

/// An extrude surface.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExtrudeSurface {
    /// An extrude plane.
    ExtrudePlane(ExtrudePlane),
    ExtrudeArc(ExtrudeArc),
    Chamfer(ChamferSurface),
    Fillet(FilletSurface),
}

// Chamfer surface.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChamferSurface {
    /// The id for the chamfer surface.
    pub face_id: uuid::Uuid,
    /// The tag.
    pub tag: Option<Node<TagDeclarator>>,
    /// Metadata.
    #[serde(flatten)]
    pub geo_meta: GeoMeta,
}

// Fillet surface.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FilletSurface {
    /// The id for the fillet surface.
    pub face_id: uuid::Uuid,
    /// The tag.
    pub tag: Option<Node<TagDeclarator>>,
    /// Metadata.
    #[serde(flatten)]
    pub geo_meta: GeoMeta,
}

/// An extruded plane.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExtrudePlane {
    /// The face id for the extrude plane.
    pub face_id: uuid::Uuid,
    /// The tag.
    pub tag: Option<Node<TagDeclarator>>,
    /// Metadata.
    #[serde(flatten)]
    pub geo_meta: GeoMeta,
}

/// An extruded arc.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExtrudeArc {
    /// The face id for the extrude plane.
    pub face_id: uuid::Uuid,
    /// The tag.
    pub tag: Option<Node<TagDeclarator>>,
    /// Metadata.
    #[serde(flatten)]
    pub geo_meta: GeoMeta,
}

impl ExtrudeSurface {
    pub fn get_id(&self) -> uuid::Uuid {
        match self {
            ExtrudeSurface::ExtrudePlane(ep) => ep.geo_meta.id,
            ExtrudeSurface::ExtrudeArc(ea) => ea.geo_meta.id,
            ExtrudeSurface::Fillet(f) => f.geo_meta.id,
            ExtrudeSurface::Chamfer(c) => c.geo_meta.id,
        }
    }

    pub fn get_tag(&self) -> Option<Node<TagDeclarator>> {
        match self {
            ExtrudeSurface::ExtrudePlane(ep) => ep.tag.clone(),
            ExtrudeSurface::ExtrudeArc(ea) => ea.tag.clone(),
            ExtrudeSurface::Fillet(f) => f.tag.clone(),
            ExtrudeSurface::Chamfer(c) => c.tag.clone(),
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
#[derive(Debug, Clone)]
pub struct ExecutorSettings {
    /// The unit to use in modeling dimensions.
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
}

impl Default for ExecutorSettings {
    fn default() -> Self {
        Self {
            units: Default::default(),
            highlight_edges: true,
            enable_ssao: false,
            show_grid: false,
            replay: None,
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
        }
    }
}

/// Create a new zoo api client.
#[cfg(not(target_arch = "wasm32"))]
pub fn new_zoo_client(token: Option<String>, engine_addr: Option<String>) -> Result<kittycad::Client> {
    let user_agent = concat!(env!("CARGO_PKG_NAME"), ".rs/", env!("CARGO_PKG_VERSION"),);
    let http_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60));
    let ws_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60))
        .connection_verbose(true)
        .tcp_keepalive(std::time::Duration::from_secs(600))
        .http1_only();

    let zoo_token_env = std::env::var("ZOO_API_TOKEN");

    let token = if let Some(token) = token {
        token
    } else if let Ok(token) = std::env::var("KITTYCAD_API_TOKEN") {
        if let Ok(zoo_token) = zoo_token_env {
            if zoo_token != token {
                return Err(anyhow::anyhow!(
                    "Both environment variables KITTYCAD_API_TOKEN=`{}` and ZOO_API_TOKEN=`{}` are set. Use only one.",
                    token,
                    zoo_token
                ));
            }
        }
        token
    } else if let Ok(token) = zoo_token_env {
        token
    } else {
        return Err(anyhow::anyhow!(
            "No API token found in environment variables. Use KITTYCAD_API_TOKEN or ZOO_API_TOKEN"
        ));
    };

    // Create the client.
    let mut client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);
    // Set an engine address if it's set.
    let kittycad_host_env = std::env::var("KITTYCAD_HOST");
    if let Some(addr) = engine_addr {
        client.set_base_url(addr);
    } else if let Ok(addr) = std::env::var("ZOO_HOST") {
        if let Ok(kittycad_host) = kittycad_host_env {
            if kittycad_host != addr {
                return Err(anyhow::anyhow!(
                    "Both environment variables KITTYCAD_HOST=`{}` and ZOO_HOST=`{}` are set. Use only one.",
                    kittycad_host,
                    addr
                ));
            }
        }
        client.set_base_url(addr);
    } else if let Ok(addr) = kittycad_host_env {
        client.set_base_url(addr);
    }

    Ok(client)
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

        // Set the edge visibility.
        engine
            .batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                SourceRange::default(),
                &ModelingCmd::from(mcmd::EdgeLinesVisible {
                    hidden: !settings.highlight_edges,
                }),
            )
            .await?;

        Ok(Self {
            engine,
            fs: Arc::new(FileManager::new()),
            stdlib: Arc::new(StdLib::new()),
            settings,
            context_type: ContextType::Live,
        })
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
        let client = new_zoo_client(token, engine_addr)?;

        let ctx = Self::new(&client, settings).await?;
        Ok(ctx)
    }

    /// Create a new default executor context.
    /// With the default kittycad client.
    /// This allows for passing in `ZOO_API_TOKEN` and `ZOO_HOST` as environment
    /// variables.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new_with_default_client(settings: ExecutorSettings) -> Result<Self> {
        // Create the client.
        let ctx = Self::new_with_client(settings, None, None).await?;
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
            },
            None,
            engine_addr,
        )
        .await?;
        Ok(ctx)
    }

    pub async fn reset_scene(
        &self,
        id_generator: &mut IdGenerator,
        source_range: crate::executor::SourceRange,
    ) -> Result<()> {
        self.engine.clear_scene(id_generator, source_range).await?;
        Ok(())
    }

    /// Perform the execution of a program.
    /// You can optionally pass in some initialization memory.
    /// Kurt uses this for partial execution.
    pub async fn run(
        &self,
        program: NodeRef<'_, crate::ast::types::Program>,
        memory: Option<ProgramMemory>,
        id_generator: IdGenerator,
        project_directory: Option<String>,
    ) -> Result<ExecState, KclError> {
        self.run_with_session_data(program, memory, id_generator, project_directory)
            .await
            .map(|x| x.0)
    }
    /// Perform the execution of a program.
    /// You can optionally pass in some initialization memory.
    /// Kurt uses this for partial execution.
    pub async fn run_with_session_data(
        &self,
        program: NodeRef<'_, crate::ast::types::Program>,
        memory: Option<ProgramMemory>,
        id_generator: IdGenerator,
        project_directory: Option<String>,
    ) -> Result<(ExecState, Option<ModelingSessionData>), KclError> {
        let memory = if let Some(memory) = memory {
            memory.clone()
        } else {
            Default::default()
        };
        let mut exec_state = ExecState {
            memory,
            id_generator,
            project_directory,
            ..Default::default()
        };
        // Before we even start executing the program, set the units.
        self.engine
            .batch_modeling_cmd(
                exec_state.id_generator.next_uuid(),
                SourceRange::default(),
                &ModelingCmd::from(mcmd::SetSceneUnits {
                    unit: match self.settings.units {
                        UnitLength::Cm => kcmc::units::UnitLength::Centimeters,
                        UnitLength::Ft => kcmc::units::UnitLength::Feet,
                        UnitLength::In => kcmc::units::UnitLength::Inches,
                        UnitLength::M => kcmc::units::UnitLength::Meters,
                        UnitLength::Mm => kcmc::units::UnitLength::Millimeters,
                        UnitLength::Yd => kcmc::units::UnitLength::Yards,
                    },
                }),
            )
            .await?;

        self.inner_execute(program, &mut exec_state, crate::executor::BodyType::Root)
            .await?;
        let session_data = self.engine.get_session_data();
        Ok((exec_state, session_data))
    }

    /// Execute an AST's program.
    #[async_recursion]
    pub(crate) async fn inner_execute<'a>(
        &'a self,
        program: NodeRef<'a, crate::ast::types::Program>,
        exec_state: &mut ExecState,
        body_type: BodyType,
    ) -> Result<Option<KclValue>, KclError> {
        let mut last_expr = None;
        // Iterate over the body of the program.
        for statement in &program.body {
            match statement {
                BodyItem::ImportStatement(import_stmt) => {
                    let source_range = SourceRange::from(import_stmt);
                    let path = import_stmt.path.clone();
                    let resolved_path = if let Some(project_dir) = &exec_state.project_directory {
                        std::path::PathBuf::from(project_dir).join(&path)
                    } else {
                        std::path::PathBuf::from(&path)
                    };
                    if exec_state.import_stack.contains(&resolved_path) {
                        return Err(KclError::ImportCycle(KclErrorDetails {
                            message: format!(
                                "circular import of modules is not allowed: {} -> {}",
                                exec_state
                                    .import_stack
                                    .iter()
                                    .map(|p| p.as_path().to_string_lossy())
                                    .collect::<Vec<_>>()
                                    .join(" -> "),
                                resolved_path.to_string_lossy()
                            ),
                            source_ranges: vec![import_stmt.into()],
                        }));
                    }
                    let source = self.fs.read_to_string(&resolved_path, source_range).await?;
                    let program = crate::parser::parse(&source)?;
                    let (module_memory, module_exports) = {
                        exec_state.import_stack.push(resolved_path.clone());
                        let original_execution = self.engine.replace_execution_kind(ExecutionKind::Isolated);
                        let original_memory = std::mem::take(&mut exec_state.memory);
                        let original_exports = std::mem::take(&mut exec_state.module_exports);
                        let result = self
                            .inner_execute(&program, exec_state, crate::executor::BodyType::Root)
                            .await;
                        let module_exports = std::mem::replace(&mut exec_state.module_exports, original_exports);
                        let module_memory = std::mem::replace(&mut exec_state.memory, original_memory);
                        self.engine.replace_execution_kind(original_execution);
                        exec_state.import_stack.pop();

                        result.map_err(|err| {
                            if let KclError::ImportCycle(_) = err {
                                // It was an import cycle.  Keep the original message.
                                err.override_source_ranges(vec![source_range])
                            } else {
                                KclError::Semantic(KclErrorDetails {
                                    message: format!(
                                        "Error loading imported file. Open it to view more details. {path}: {}",
                                        err.message()
                                    ),
                                    source_ranges: vec![source_range],
                                })
                            }
                        })?;

                        (module_memory, module_exports)
                    };
                    for import_item in &import_stmt.items {
                        // Extract the item from the module.
                        let item = module_memory
                            .get(&import_item.name.name, import_item.into())
                            .map_err(|_err| {
                                KclError::UndefinedValue(KclErrorDetails {
                                    message: format!("{} is not defined in module", import_item.name.name),
                                    source_ranges: vec![SourceRange::from(&import_item.name)],
                                })
                            })?;
                        // Check that the item is allowed to be imported.
                        if !module_exports.contains(&import_item.name.name) {
                            return Err(KclError::Semantic(KclErrorDetails {
                                message: format!(
                                    "Cannot import \"{}\" from module because it is not exported. Add \"export\" before the definition to export it.",
                                    import_item.name.name
                                ),
                                source_ranges: vec![SourceRange::from(&import_item.name)],
                            }));
                        }

                        // Add the item to the current module.
                        exec_state.memory.add(
                            import_item.identifier(),
                            item.clone(),
                            SourceRange::from(&import_item.name),
                        )?;
                    }
                    last_expr = None;
                }
                BodyItem::ExpressionStatement(expression_statement) => {
                    let metadata = Metadata::from(expression_statement);
                    last_expr = Some(
                        self.execute_expr(
                            &expression_statement.expression,
                            exec_state,
                            &metadata,
                            StatementKind::Expression,
                        )
                        .await?,
                    );
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    for declaration in &variable_declaration.declarations {
                        let var_name = declaration.id.name.to_string();
                        let source_range = SourceRange::from(&declaration.init);
                        let metadata = Metadata { source_range };

                        let memory_item = self
                            .execute_expr(
                                &declaration.init,
                                exec_state,
                                &metadata,
                                StatementKind::Declaration { name: &var_name },
                            )
                            .await?;
                        let is_function = memory_item.is_function();
                        exec_state.memory.add(&var_name, memory_item, source_range)?;
                        // Track exports.
                        match variable_declaration.visibility {
                            ItemVisibility::Export => {
                                if !is_function {
                                    return Err(KclError::Semantic(KclErrorDetails {
                                        message: "Only functions can be exported".to_owned(),
                                        source_ranges: vec![source_range],
                                    }));
                                }
                                exec_state.module_exports.insert(var_name);
                            }
                            ItemVisibility::Default => {}
                        }
                    }
                    last_expr = None;
                }
                BodyItem::ReturnStatement(return_statement) => {
                    let metadata = Metadata::from(return_statement);
                    let value = self
                        .execute_expr(
                            &return_statement.argument,
                            exec_state,
                            &metadata,
                            StatementKind::Expression,
                        )
                        .await?;
                    exec_state.memory.return_ = Some(value);
                    last_expr = None;
                }
            }
        }

        if BodyType::Root == body_type {
            // Flush the batch queue.
            self.engine
                .flush_batch(
                    // True here tells the engine to flush all the end commands as well like fillets
                    // and chamfers where the engine would otherwise eat the ID of the segments.
                    true,
                    SourceRange([program.end, program.end]),
                )
                .await?;
        }

        Ok(last_expr)
    }

    pub async fn execute_expr<'a>(
        &self,
        init: &Expr,
        exec_state: &mut ExecState,
        metadata: &Metadata,
        statement_kind: StatementKind<'a>,
    ) -> Result<KclValue, KclError> {
        let item = match init {
            Expr::None(none) => KclValue::from(none),
            Expr::Literal(literal) => KclValue::from(literal),
            Expr::TagDeclarator(tag) => tag.execute(exec_state).await?,
            Expr::Identifier(identifier) => {
                let value = exec_state.memory.get(&identifier.name, identifier.into())?;
                value.clone()
            }
            Expr::BinaryExpression(binary_expression) => binary_expression.get_result(exec_state, self).await?,
            Expr::FunctionExpression(function_expression) => {
                // Cloning memory here is crucial for semantics so that we close
                // over variables.  Variables defined lexically later shouldn't
                // be available to the function body.
                KclValue::Function {
                    expression: function_expression.clone(),
                    meta: vec![metadata.to_owned()],
                    func: None,
                    memory: Box::new(exec_state.memory.clone()),
                }
            }
            Expr::CallExpression(call_expression) => call_expression.execute(exec_state, self).await?,
            Expr::PipeExpression(pipe_expression) => pipe_expression.get_result(exec_state, self).await?,
            Expr::PipeSubstitution(pipe_substitution) => match statement_kind {
                StatementKind::Declaration { name } => {
                    let message = format!(
                        "you cannot declare variable {name} as %, because % can only be used in function calls"
                    );

                    return Err(KclError::Semantic(KclErrorDetails {
                        message,
                        source_ranges: vec![pipe_substitution.into()],
                    }));
                }
                StatementKind::Expression => match exec_state.pipe_value.clone() {
                    Some(x) => x,
                    None => {
                        return Err(KclError::Semantic(KclErrorDetails {
                            message: "cannot use % outside a pipe expression".to_owned(),
                            source_ranges: vec![pipe_substitution.into()],
                        }));
                    }
                },
            },
            Expr::ArrayExpression(array_expression) => array_expression.execute(exec_state, self).await?,
            Expr::ArrayRangeExpression(range_expression) => range_expression.execute(exec_state, self).await?,
            Expr::ObjectExpression(object_expression) => object_expression.execute(exec_state, self).await?,
            Expr::MemberExpression(member_expression) => member_expression.get_result(exec_state)?,
            Expr::UnaryExpression(unary_expression) => unary_expression.get_result(exec_state, self).await?,
            Expr::IfExpression(expr) => expr.get_result(exec_state, self).await?,
        };
        Ok(item)
    }

    /// Update the units for the executor.
    pub fn update_units(&mut self, units: UnitLength) {
        self.settings.units = units;
    }

    /// Execute the program, then get a PNG screenshot.
    pub async fn execute_and_prepare_snapshot(
        &self,
        program: NodeRef<'_, Program>,
        id_generator: IdGenerator,
        project_directory: Option<String>,
    ) -> Result<TakeSnapshot> {
        let _ = self.run(program, None, id_generator, project_directory).await?;

        // Zoom to fit.
        self.engine
            .send_modeling_cmd(
                uuid::Uuid::new_v4(),
                crate::executor::SourceRange::default(),
                ModelingCmd::from(mcmd::ZoomToFit {
                    object_ids: Default::default(),
                    animated: false,
                    padding: 0.1,
                }),
            )
            .await?;

        // Send a snapshot request to the engine.
        let resp = self
            .engine
            .send_modeling_cmd(
                uuid::Uuid::new_v4(),
                crate::executor::SourceRange::default(),
                ModelingCmd::from(mcmd::TakeSnapshot {
                    format: ImageFormat::Png,
                }),
            )
            .await?;

        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::TakeSnapshot(contents),
        } = resp
        else {
            anyhow::bail!("Unexpected response from engine: {:?}", resp);
        };
        Ok(contents)
    }
}

/// For each argument given,
/// assign it to a parameter of the function, in the given block of function memory.
/// Returns Err if too few/too many arguments were given for the function.
fn assign_args_to_params(
    function_expression: NodeRef<'_, FunctionExpression>,
    args: Vec<KclValue>,
    mut fn_memory: ProgramMemory,
) -> Result<ProgramMemory, KclError> {
    let num_args = function_expression.number_of_args();
    let (min_params, max_params) = num_args.into_inner();
    let n = args.len();

    // Check if the user supplied too many arguments
    // (we'll check for too few arguments below).
    let err_wrong_number_args = KclError::Semantic(KclErrorDetails {
        message: if min_params == max_params {
            format!("Expected {min_params} arguments, got {n}")
        } else {
            format!("Expected {min_params}-{max_params} arguments, got {n}")
        },
        source_ranges: vec![function_expression.into()],
    });
    if n > max_params {
        return Err(err_wrong_number_args);
    }

    // Add the arguments to the memory.  A new call frame should have already
    // been created.
    for (index, param) in function_expression.params.iter().enumerate() {
        if let Some(arg) = args.get(index) {
            // Argument was provided.
            fn_memory.add(&param.identifier.name, arg.clone(), (&param.identifier).into())?;
        } else {
            // Argument was not provided.
            if param.optional {
                // If the corresponding parameter is optional,
                // then it's fine, the user doesn't need to supply it.
                let none = KclNone::new(param.identifier.start, param.identifier.end);
                fn_memory.add(
                    &param.identifier.name,
                    KclValue::from(&none),
                    (&param.identifier).into(),
                )?;
            } else {
                // But if the corresponding parameter was required,
                // then the user has called with too few arguments.
                return Err(err_wrong_number_args);
            }
        }
    }
    Ok(fn_memory)
}

pub(crate) async fn call_user_defined_function(
    args: Vec<KclValue>,
    memory: &ProgramMemory,
    function_expression: NodeRef<'_, FunctionExpression>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Option<KclValue>, KclError> {
    // Create a new environment to execute the function body in so that local
    // variables shadow variables in the parent scope.  The new environment's
    // parent should be the environment of the closure.
    let mut body_memory = memory.clone();
    let body_env = body_memory.new_env_for_call(memory.current_env);
    body_memory.current_env = body_env;
    let fn_memory = assign_args_to_params(function_expression, args, body_memory)?;

    // Execute the function body using the memory we just created.
    let (result, fn_memory) = {
        let previous_memory = std::mem::replace(&mut exec_state.memory, fn_memory);
        let result = ctx
            .inner_execute(&function_expression.body, exec_state, BodyType::Block)
            .await;
        // Restore the previous memory.
        let fn_memory = std::mem::replace(&mut exec_state.memory, previous_memory);

        (result, fn_memory)
    };

    result.map(|_| fn_memory.return_)
}

pub enum StatementKind<'a> {
    Declaration { name: &'a str },
    Expression,
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use pretty_assertions::assert_eq;

    use super::*;
    use crate::ast::types::{Identifier, Node, Parameter};

    pub async fn parse_execute(code: &str) -> Result<ProgramMemory> {
        let tokens = crate::token::lexer(code)?;
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast()?;
        let ctx = ExecutorContext {
            engine: Arc::new(Box::new(crate::engine::conn_mock::EngineConnection::new().await?)),
            fs: Arc::new(crate::fs::FileManager::new()),
            stdlib: Arc::new(crate::std::StdLib::new()),
            settings: Default::default(),
            context_type: ContextType::Mock,
        };
        let exec_state = ctx.run(&program, None, IdGenerator::default(), None).await?;

        Ok(exec_state.memory)
    }

    /// Convenience function to get a JSON value from memory and unwrap.
    fn mem_get_json(memory: &ProgramMemory, name: &str) -> serde_json::Value {
        memory
            .get(name, SourceRange::default())
            .unwrap()
            .get_json_value()
            .unwrap()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_assign_two_variables() {
        let ast = r#"const myVar = 5
const newVar = myVar + 1"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(5),
            memory
                .get("myVar", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
        assert_eq!(
            serde_json::json!(6.0),
            memory
                .get("newVar", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_angled_line_that_intersects() {
        let ast_fn = |offset: &str| -> String {
            format!(
                r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([2, 2], %, $yo)
  |> lineTo([3, 1], %)
  |> angledLineThatIntersects({{
  angle: 180,
  intersectTag: yo,
  offset: {},
}}, %, $yo2)
const intersect = segEndX(yo2)"#,
                offset
            )
        };

        let memory = parse_execute(&ast_fn("-1")).await.unwrap();
        assert_eq!(
            serde_json::json!(1.0 + 2.0f64.sqrt()),
            memory
                .get("intersect", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );

        let memory = parse_execute(&ast_fn("0")).await.unwrap();
        assert_eq!(
            serde_json::json!(1.0000000000000002),
            memory
                .get("intersect", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
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

const yo = 5 + 6

const abc = 3
const identifierGuy = 5
const part001 = startSketchOn('XY')
|> startProfileAt([-1.2, 4.83], %)
|> line([2.8, 0], %)
|> angledLine([100 + 100, 3.01], %)
|> angledLine([abc, 3.02], %)
|> angledLine([def(yo), 3.03], %)
|> angledLine([ghi(2), 3.04], %)
|> angledLine([jkl(yo) + 2, 3.05], %)
|> close(%)
const yo2 = hmm([identifierGuy + 5])"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_pipe_substitutions_unary() {
        let ast = r#"const myVar = 3
const part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([3, 4], %, $seg01)
  |> line([
  min(segLen(seg01), myVar),
  -legLen(segLen(seg01), myVar)
], %)
"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_pipe_substitutions() {
        let ast = r#"const myVar = 3
const part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([3, 4], %, $seg01)
  |> line([
  min(segLen(seg01), myVar),
  legLen(segLen(seg01), myVar)
], %)
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
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, thing()], %)
  |> close(%)
  |> extrude(h, %)"#;

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
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, thing(8)], %)
  |> close(%)
  |> extrude(h, %)"#;

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
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line(thing(8), %)
  |> close(%)
  |> extrude(h, %)"#;

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
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, thing(8)], %)
  |> close(%)
  |> extrude(h, %)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_sketch() {
        let ast = r#"fn box = (h, l, w) => {
 const myBox = startSketchOn('XY')
    |> startProfileAt([0,0], %)
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

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
    |> line([0, obj.l], %)
    |> line([obj.w, 0], %)
    |> line([0, -obj.l], %)
    |> close(%)
    |> extrude(obj.h, %)

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
    |> line([0, obj["l"]], %)
    |> line([obj["w"], 0], %)
    |> line([0, -obj["l"]], %)
    |> close(%)
    |> extrude(obj["h"], %)

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
    |> line([0, obj["l"]], %)
    |> line([obj["w"], 0], %)
    |> line([10 - obj["w"], -obj.l], %)
    |> close(%)
    |> extrude(obj["h"], %)

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
      |> line([0, 1], %)
      |> line([1, 0], %)
      |> line([0, -1], %)
      |> close(%)
  }
}

const x2 = test2()

x2.thing
  |> extrude(10, %)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // ignore til we get loops
    async fn test_execute_with_function_sketch_loop_objects() {
        let ast = r#"fn box = (obj) => {
let myBox = startSketchOn('XY')
    |> startProfileAt(obj.start, %)
    |> line([0, obj.l], %)
    |> line([obj.w, 0], %)
    |> line([0, -obj.l], %)
    |> close(%)
    |> extrude(obj.h, %)

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
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}


for var in [[3, 6, 10, [0,0]], [1.5, 3, 5, [-10,-10]]] {
  const thisBox = box(var[0], var[1], var[2], var[3])
}"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_array_with_function() {
        let ast = r#"fn box = (array) => {
 let myBox =startSketchOn('XY')
    |> startProfileAt(array[0], %)
    |> line([0, array[1]], %)
    |> line([array[2], 0], %)
    |> line([0, -array[1]], %)
    |> close(%)
    |> extrude(array[3], %)

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
                source_ranges: vec![SourceRange([64, 65]), SourceRange([97, 106])],
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
    |> extrude(10, %)
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
                source_ranges: vec![SourceRange([80, 81])],
            }),
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_function_with_parameter_redefined_outside() {
        let ast = r#"
fn myIdentity = (x) => {
  return x
}

const x = 33

const two = myIdentity(2)"#;

        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(2),
            memory
                .get("two", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
        assert_eq!(
            serde_json::json!(33),
            memory
                .get("x", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_function_referencing_variable_in_parent_scope() {
        let ast = r#"
const x = 22
const y = 3

fn add = (x) => {
  return x + y
}

const answer = add(2)"#;

        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(5.0),
            memory
                .get("answer", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
        assert_eq!(
            serde_json::json!(22),
            memory
                .get("x", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_function_redefining_variable_in_parent_scope() {
        let ast = r#"
const x = 1

fn foo = () => {
  const x = 2
  return x
}

const answer = foo()"#;

        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(2),
            memory
                .get("answer", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
        assert_eq!(
            serde_json::json!(1),
            memory
                .get("x", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_pattern_transform_function_redefining_variable_in_parent_scope() {
        let ast = r#"
const scale = 100
fn transform = (replicaId) => {
  // Redefine same variable as in parent scope.
  const scale = 2
  return {
    translate: [0, 0, replicaId * 10],
    scale: [scale, 1, 0],
  }
}

fn layer = () => {
  return startSketchOn("XY")
    |> circle({ center: [0, 0], radius: 1 }, %, $tag1)
    |> extrude(10, %)
}

// The 10 layers are replicas of each other, with a transform applied to each.
let shape = layer() |> patternTransform(10, transform, %)"#;

        let memory = parse_execute(ast).await.unwrap();
        // TODO: Assert that scale 2 was used.
        assert_eq!(
            serde_json::json!(100),
            memory
                .get("scale", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_with_functions() {
        let ast = r#"const myVar = 2 + min(100, -1 + legLen(5, 3))"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(5.0),
            memory
                .get("myVar", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute() {
        let ast = r#"const myVar = 1 + 2 * (3 - 4) / -5 + 6"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(7.4),
            memory
                .get("myVar", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_start_negative() {
        let ast = r#"const myVar = -5 + 6"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(1.0),
            memory
                .get("myVar", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_with_pi() {
        let ast = r#"const myVar = pi() * 2"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(std::f64::consts::TAU),
            memory
                .get("myVar", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_define_decimal_without_leading_zero() {
        let ast = r#"let thing = .4 + 7"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(7.4),
            memory
                .get("thing", SourceRange::default())
                .unwrap()
                .get_json_value()
                .unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_zero_param_fn() {
        let ast = r#"const sigmaAllow = 35000 // psi
const leg1 = 5 // inches
const leg2 = 8 // inches
fn thickness = () => { return 0.56 }

const bracket = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness()], %)
  |> line([-leg2 + thickness(), 0], %)
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
        let mem = parse_execute(ast).await.unwrap();
        assert_eq!(serde_json::json!(false), mem_get_json(&mem, "notTrue"));
        assert_eq!(serde_json::json!(true), mem_get_json(&mem, "notFalse"));
        assert_eq!(serde_json::json!(true), mem_get_json(&mem, "c"));
        assert_eq!(serde_json::json!(false), mem_get_json(&mem, "d"));
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
                message: "Cannot apply unary operator ! to non-boolean value: null".to_owned(),
                source_ranges: vec![SourceRange([56, 63])],
            })
        );

        let code2 = "let notZero = !0";
        assert_eq!(
            parse_execute(code2).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: 0".to_owned(),
                source_ranges: vec![SourceRange([14, 16])],
            })
        );

        let code3 = r#"
let notEmptyString = !""
"#;
        assert_eq!(
            parse_execute(code3).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: \"\"".to_owned(),
                source_ranges: vec![SourceRange([22, 25])],
            })
        );

        let code4 = r#"
let obj = { a: 1 }
let notMember = !obj.a
"#;
        assert_eq!(
            parse_execute(code4).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: 1".to_owned(),
                source_ranges: vec![SourceRange([36, 42])],
            })
        );

        let code5 = "
let a = []
let notArray = !a";
        assert_eq!(
            parse_execute(code5).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: []".to_owned(),
                source_ranges: vec![SourceRange([27, 29])],
            })
        );

        let code6 = "
let x = {}
let notObject = !x";
        assert_eq!(
            parse_execute(code6).await.unwrap_err().downcast::<KclError>().unwrap(),
            KclError::Semantic(KclErrorDetails {
                message: "Cannot apply unary operator ! to non-boolean value: {}".to_owned(),
                source_ranges: vec![SourceRange([28, 30])],
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
                .starts_with("Cannot apply unary operator ! to non-boolean value: {\"type\":\"TagDeclarator\","),
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
                .starts_with("Cannot apply unary operator ! to non-boolean value: {\"type\":\"TagIdentifier\","),
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
                source_ranges: vec![SourceRange([14, 15])],
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
                source_ranges: vec![SourceRange([54, 56])],
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
  |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness], %)
  |> line([-leg2 + thickness, 0], %)
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
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"undefined value: KclErrorDetails { source_ranges: [SourceRange([10, 34])], message: "Result of user-defined function test is undefined" }"#.to_owned()
        );
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
    |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness], %)
  |> line([-1 * leg2 + thickness, 0], %)
  |> line([0, -1 * leg1 + thickness], %)
  |> close(%)
  |> extrude(width, %)
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
    |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness], %)
  |> line([-1 * leg2 + thickness, 0], %)
  |> line([0, -1 * leg1 + thickness], %)
  |> close(%)
  |> extrude(width, %)
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
            KclValue::UserVal(UserVal {
                value: number.into(),
                meta: Default::default(),
            })
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
                optional: true,
                digest: None,
            }
        }
        fn req_param(s: &'static str) -> Parameter {
            Parameter {
                identifier: ident(s),
                type_: None,
                optional: false,
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
                    source_ranges: vec![SourceRange([0, 0])],
                    message: "Expected 1 arguments, got 0".to_owned(),
                })),
            ),
            (
                "all params optional, none given, should be OK",
                vec![opt_param("x")],
                vec![],
                Ok(additional_program_memory(&[(
                    "x".to_owned(),
                    KclValue::from(&KclNone::default()),
                )])),
            ),
            (
                "mixed params, too few given",
                vec![req_param("x"), opt_param("y")],
                vec![],
                Err(KclError::Semantic(KclErrorDetails {
                    source_ranges: vec![SourceRange([0, 0])],
                    message: "Expected 1-2 arguments, got 0".to_owned(),
                })),
            ),
            (
                "mixed params, minimum given, should be OK",
                vec![req_param("x"), opt_param("y")],
                vec![mem(1)],
                Ok(additional_program_memory(&[
                    ("x".to_owned(), mem(1)),
                    ("y".to_owned(), KclValue::from(&KclNone::default())),
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
                    source_ranges: vec![SourceRange([0, 0])],
                    message: "Expected 1-2 arguments, got 3".to_owned(),
                })),
            ),
        ] {
            // Run each test.
            let func_expr = &Node::no_src(FunctionExpression {
                params,
                body: Node {
                    inner: crate::ast::types::Program {
                        body: Vec::new(),
                        non_code_meta: Default::default(),
                        digest: None,
                    },
                    start: 0,
                    end: 0,
                },
                return_type: None,
                digest: None,
            });
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
}
