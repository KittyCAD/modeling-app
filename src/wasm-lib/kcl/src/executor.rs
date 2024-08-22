//! The executor for the AST.

use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use async_recursion::async_recursion;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value as JValue;
use tower_lsp::lsp_types::{Position as LspPosition, Range as LspRange};

use crate::{
    ast::types::{
        human_friendly_type, BodyItem, Expr, ExpressionStatement, FunctionExpression, KclNone, Program,
        ReturnStatement, TagDeclarator,
    },
    engine::EngineManager,
    errors::{KclError, KclErrorDetails},
    fs::FileManager,
    settings::types::UnitLength,
    std::{FnAsArg, StdLib},
};

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

    /// Find all extrude groups in the memory that are on a specific sketch group id.
    /// This does not look inside closures.  But as long as we do not allow
    /// mutation of variables in KCL, closure memory should be a subset of this.
    pub fn find_extrude_groups_on_sketch_group(&self, sketch_group_id: uuid::Uuid) -> Vec<Box<ExtrudeGroup>> {
        self.environments
            .iter()
            .flat_map(|env| {
                env.bindings
                    .values()
                    .filter_map(|item| match item {
                        KclValue::ExtrudeGroup(eg) if eg.sketch_group.id == sketch_group_id => Some(eg.clone()),
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

    pub fn update_sketch_group_tags(&mut self, sg: &SketchGroup) {
        if sg.tags.is_empty() {
            return;
        }

        for (_, val) in self.bindings.iter_mut() {
            let KclValue::UserVal(v) = val else { continue };
            let meta = v.meta.clone();
            let maybe_sg: Result<SketchGroup, _> = serde_json::from_value(v.value.clone());
            let Ok(mut sketch_group) = maybe_sg else {
                continue;
            };

            if sketch_group.original_id == sg.original_id {
                for tag in sg.tags.iter() {
                    sketch_group.tags.insert(tag.0.clone(), tag.1.clone());
                }
            }
            *val = KclValue::UserVal(UserVal {
                meta,
                value: serde_json::to_value(sketch_group).expect("can always turn SketchGroup into JSON"),
            });
        }
    }
}

/// Dynamic state that depends on the dynamic flow of the program, like the call
/// stack.  If the language had exceptions, for example, you could store the
/// stack of exception handlers here.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, ts_rs::TS, JsonSchema)]
pub struct DynamicState {
    pub extrude_group_ids: Vec<ExtrudeGroupLazyIds>,
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
                if let KclValue::ExtrudeGroup(eg) = item {
                    self.extrude_group_ids.push(ExtrudeGroupLazyIds::from(eg.as_ref()));
                }
            }
        }
    }

    pub fn edge_cut_ids_on_sketch_group(&self, sketch_group_id: uuid::Uuid) -> Vec<uuid::Uuid> {
        self.extrude_group_ids
            .iter()
            .flat_map(|eg| {
                if eg.sketch_group_id == sketch_group_id {
                    eg.edge_cuts.clone()
                } else {
                    Vec::new()
                }
            })
            .collect::<Vec<_>>()
    }
}

/// A memory item.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum KclValue {
    UserVal(UserVal),
    TagIdentifier(Box<TagIdentifier>),
    TagDeclarator(Box<TagDeclarator>),
    Plane(Box<Plane>),
    Face(Box<Face>),

    ExtrudeGroup(Box<ExtrudeGroup>),
    ExtrudeGroups {
        value: Vec<Box<ExtrudeGroup>>,
    },
    ImportedGeometry(ImportedGeometry),
    #[ts(skip)]
    Function {
        #[serde(skip)]
        func: Option<MemoryFunction>,
        expression: Box<FunctionExpression>,
        memory: Box<ProgramMemory>,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
}

impl KclValue {
    pub(crate) fn new_user_val<T: Serialize>(meta: Vec<Metadata>, val: T) -> Self {
        Self::UserVal(UserVal::set(meta, val))
    }

    pub(crate) fn get_extrude_group_set(&self) -> Result<ExtrudeGroupSet> {
        match self {
            KclValue::ExtrudeGroup(e) => Ok(ExtrudeGroupSet::ExtrudeGroup(e.clone())),
            KclValue::ExtrudeGroups { value } => Ok(ExtrudeGroupSet::ExtrudeGroups(value.clone())),
            KclValue::UserVal(value) => {
                let value = value.value.clone();
                match value {
                    JValue::Null | JValue::Bool(_) | JValue::Number(_) | JValue::String(_) => Err(anyhow::anyhow!(
                        "Failed to deserialize extrude group set from JSON {}",
                        human_friendly_type(&value)
                    )),
                    JValue::Array(_) => serde_json::from_value::<Vec<Box<ExtrudeGroup>>>(value)
                        .map(ExtrudeGroupSet::from)
                        .map_err(|e| anyhow::anyhow!("Failed to deserialize array of extrude groups from JSON: {}", e)),
                    JValue::Object(_) => serde_json::from_value::<Box<ExtrudeGroup>>(value)
                        .map(ExtrudeGroupSet::from)
                        .map_err(|e| anyhow::anyhow!("Failed to deserialize extrude group from JSON: {}", e)),
                }
            }
            _ => anyhow::bail!("Not a extrude group or extrude groups: {:?}", self),
        }
    }

    /// Human readable type name used in error messages.  Should not be relied
    /// on for program logic.
    pub(crate) fn human_friendly_type(&self) -> &'static str {
        match self {
            KclValue::UserVal(u) => human_friendly_type(&u.value),
            KclValue::TagDeclarator(_) => "TagDeclarator",
            KclValue::TagIdentifier(_) => "TagIdentifier",
            KclValue::ExtrudeGroup(_) => "ExtrudeGroup",
            KclValue::ExtrudeGroups { .. } => "ExtrudeGroups",
            KclValue::ImportedGeometry(_) => "ImportedGeometry",
            KclValue::Function { .. } => "Function",
            KclValue::Plane(_) => "Plane",
            KclValue::Face(_) => "Face",
        }
    }
}

impl From<SketchGroupSet> for KclValue {
    fn from(sg: SketchGroupSet) -> Self {
        KclValue::UserVal(UserVal::set(sg.meta(), sg))
    }
}

impl From<Vec<Box<SketchGroup>>> for KclValue {
    fn from(sg: Vec<Box<SketchGroup>>) -> Self {
        let meta = sg.iter().flat_map(|sg| sg.meta.clone()).collect();
        KclValue::UserVal(UserVal::set(meta, sg))
    }
}

impl From<ExtrudeGroupSet> for KclValue {
    fn from(eg: ExtrudeGroupSet) -> Self {
        match eg {
            ExtrudeGroupSet::ExtrudeGroup(eg) => KclValue::ExtrudeGroup(eg),
            ExtrudeGroupSet::ExtrudeGroups(egs) => KclValue::ExtrudeGroups { value: egs },
        }
    }
}

impl From<Vec<Box<ExtrudeGroup>>> for KclValue {
    fn from(eg: Vec<Box<ExtrudeGroup>>) -> Self {
        if eg.len() == 1 {
            KclValue::ExtrudeGroup(eg[0].clone())
        } else {
            KclValue::ExtrudeGroups { value: eg }
        }
    }
}

/// A geometry.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Geometry {
    SketchGroup(Box<SketchGroup>),
    ExtrudeGroup(Box<ExtrudeGroup>),
}

impl Geometry {
    pub fn id(&self) -> uuid::Uuid {
        match self {
            Geometry::SketchGroup(s) => s.id,
            Geometry::ExtrudeGroup(e) => e.id,
        }
    }
}

/// A set of geometry.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Geometries {
    SketchGroups(Vec<Box<SketchGroup>>),
    ExtrudeGroups(Vec<Box<ExtrudeGroup>>),
}

/// A sketch group or a group of sketch groups.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SketchGroupSet {
    SketchGroup(Box<SketchGroup>),
    SketchGroups(Vec<Box<SketchGroup>>),
}

impl SketchGroupSet {
    pub fn meta(&self) -> Vec<Metadata> {
        match self {
            SketchGroupSet::SketchGroup(sg) => sg.meta.clone(),
            SketchGroupSet::SketchGroups(sg) => sg.iter().flat_map(|sg| sg.meta.clone()).collect(),
        }
    }
}

impl From<SketchGroupSet> for Vec<SketchGroup> {
    fn from(value: SketchGroupSet) -> Self {
        match value {
            SketchGroupSet::SketchGroup(sg) => vec![*sg],
            SketchGroupSet::SketchGroups(sgs) => sgs.into_iter().map(|sg| *sg).collect(),
        }
    }
}

impl From<SketchGroup> for SketchGroupSet {
    fn from(sg: SketchGroup) -> Self {
        SketchGroupSet::SketchGroup(Box::new(sg))
    }
}

impl From<Box<SketchGroup>> for SketchGroupSet {
    fn from(sg: Box<SketchGroup>) -> Self {
        SketchGroupSet::SketchGroup(sg)
    }
}

impl From<Vec<SketchGroup>> for SketchGroupSet {
    fn from(sg: Vec<SketchGroup>) -> Self {
        if sg.len() == 1 {
            SketchGroupSet::SketchGroup(Box::new(sg[0].clone()))
        } else {
            SketchGroupSet::SketchGroups(sg.into_iter().map(Box::new).collect())
        }
    }
}

impl From<Vec<Box<SketchGroup>>> for SketchGroupSet {
    fn from(sg: Vec<Box<SketchGroup>>) -> Self {
        if sg.len() == 1 {
            SketchGroupSet::SketchGroup(sg[0].clone())
        } else {
            SketchGroupSet::SketchGroups(sg)
        }
    }
}

impl From<SketchGroupSet> for Vec<Box<SketchGroup>> {
    fn from(sg: SketchGroupSet) -> Self {
        match sg {
            SketchGroupSet::SketchGroup(sg) => vec![sg],
            SketchGroupSet::SketchGroups(sgs) => sgs,
        }
    }
}

impl From<&SketchGroup> for Vec<Box<SketchGroup>> {
    fn from(sg: &SketchGroup) -> Self {
        vec![Box::new(sg.clone())]
    }
}

impl From<Box<SketchGroup>> for Vec<Box<SketchGroup>> {
    fn from(sg: Box<SketchGroup>) -> Self {
        vec![sg]
    }
}

/// A extrude group or a group of extrude groups.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExtrudeGroupSet {
    ExtrudeGroup(Box<ExtrudeGroup>),
    ExtrudeGroups(Vec<Box<ExtrudeGroup>>),
}

impl From<ExtrudeGroup> for ExtrudeGroupSet {
    fn from(eg: ExtrudeGroup) -> Self {
        ExtrudeGroupSet::ExtrudeGroup(Box::new(eg))
    }
}

impl From<Box<ExtrudeGroup>> for ExtrudeGroupSet {
    fn from(eg: Box<ExtrudeGroup>) -> Self {
        ExtrudeGroupSet::ExtrudeGroup(eg)
    }
}

impl From<Vec<ExtrudeGroup>> for ExtrudeGroupSet {
    fn from(eg: Vec<ExtrudeGroup>) -> Self {
        if eg.len() == 1 {
            ExtrudeGroupSet::ExtrudeGroup(Box::new(eg[0].clone()))
        } else {
            ExtrudeGroupSet::ExtrudeGroups(eg.into_iter().map(Box::new).collect())
        }
    }
}

impl From<Vec<Box<ExtrudeGroup>>> for ExtrudeGroupSet {
    fn from(eg: Vec<Box<ExtrudeGroup>>) -> Self {
        if eg.len() == 1 {
            ExtrudeGroupSet::ExtrudeGroup(eg[0].clone())
        } else {
            ExtrudeGroupSet::ExtrudeGroups(eg)
        }
    }
}

impl From<ExtrudeGroupSet> for Vec<Box<ExtrudeGroup>> {
    fn from(eg: ExtrudeGroupSet) -> Self {
        match eg {
            ExtrudeGroupSet::ExtrudeGroup(eg) => vec![eg],
            ExtrudeGroupSet::ExtrudeGroups(egs) => egs,
        }
    }
}

impl From<&ExtrudeGroup> for Vec<Box<ExtrudeGroup>> {
    fn from(eg: &ExtrudeGroup) -> Self {
        vec![Box::new(eg.clone())]
    }
}

impl From<Box<ExtrudeGroup>> for Vec<Box<ExtrudeGroup>> {
    fn from(eg: Box<ExtrudeGroup>) -> Self {
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
    /// The extrude group the face is on.
    pub extrude_group: Box<ExtrudeGroup>,
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
        *self = Self::set(meta, val);
        Ok(())
    }

    /// Put the given value into this UserVal.
    pub fn set<T: serde::Serialize>(meta: Vec<Metadata>, val: T) -> Self {
        Self {
            meta,
            value: serde_json::to_value(val).expect("all KCL values should be compatible with JSON"),
        }
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
        expression: Box<FunctionExpression>,
        metadata: Vec<Metadata>,
        dynamic_state: DynamicState,
        ctx: ExecutorContext,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Option<KclValue>, KclError>> + Send>>;

fn force_memory_function<
    F: Fn(
        Vec<KclValue>,
        ProgramMemory,
        Box<FunctionExpression>,
        Vec<Metadata>,
        DynamicState,
        ExecutorContext,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Option<KclValue>, KclError>> + Send>>,
>(
    f: F,
) -> F {
    f
}

impl From<KclValue> for Vec<SourceRange> {
    fn from(item: KclValue) -> Self {
        match item {
            KclValue::UserVal(u) => u.meta.iter().map(|m| m.source_range).collect(),
            KclValue::TagDeclarator(t) => t.into(),
            KclValue::TagIdentifier(t) => t.meta.iter().map(|m| m.source_range).collect(),
            KclValue::ExtrudeGroup(e) => e.meta.iter().map(|m| m.source_range).collect(),
            KclValue::ExtrudeGroups { value } => value
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
        let func = func.as_ref()?;
        Some(FnAsArg {
            func,
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
    pub fn get_tag_declarator(&self) -> Result<TagDeclarator, KclError> {
        match self {
            KclValue::TagDeclarator(t) => Ok(*t.clone()),
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: format!("Not a tag declarator: {:?}", self),
                source_ranges: self.clone().into(),
            })),
        }
    }

    /// Get an optional tag from a memory item.
    pub fn get_tag_declarator_opt(&self) -> Result<Option<TagDeclarator>, KclError> {
        match self {
            KclValue::TagDeclarator(t) => Ok(Some(*t.clone())),
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: format!("Not a tag declarator: {:?}", self),
                source_ranges: self.clone().into(),
            })),
        }
    }

    /// If this memory item is a function, call it with the given arguments, return its val as Ok.
    /// If it's not a function, return Err.
    pub async fn call_fn(
        &self,
        args: Vec<KclValue>,
        dynamic_state: &DynamicState,
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
        let Some(func) = func else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Not a function: {:?}", expression),
                source_ranges: vec![],
            }));
        };
        func(
            args,
            closure_memory.as_ref().clone(),
            expression.clone(),
            meta.clone(),
            dynamic_state.clone(),
            ctx,
        )
        .await
    }
}

/// Engine information for a tag.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct TagEngineInfo {
    /// The id of the tagged object.
    pub id: uuid::Uuid,
    /// The sketch group the tag is on.
    pub sketch_group: uuid::Uuid,
    /// The path the tag is on.
    pub path: Option<BasePath>,
    /// The surface information for the tag.
    pub surface: Option<ExtrudeSurface>,
}

/// A sketch group is a collection of paths.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct SketchGroup {
    /// The id of the sketch group (this will change when the engine's reference to it changes.
    pub id: uuid::Uuid,
    /// The paths in the sketch group.
    pub value: Vec<Path>,
    /// What the sketch is on (can be a plane or a face).
    pub on: SketchSurface,
    /// The starting path.
    pub start: BasePath,
    /// Tag identifiers that have been declared in this sketch group.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub tags: HashMap<String, TagIdentifier>,
    /// The original id of the sketch group. This stays the same even if the sketch group is
    /// is sketched on face etc.
    #[serde(skip)]
    pub original_id: uuid::Uuid,
    /// Metadata.
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

/// A sketch group type.
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
            SketchSurface::Plane(plane) => plane.x_axis.clone(),
            SketchSurface::Face(face) => face.x_axis.clone(),
        }
    }
    pub(crate) fn y_axis(&self) -> Point3d {
        match self {
            SketchSurface::Plane(plane) => plane.y_axis.clone(),
            SketchSurface::Face(face) => face.y_axis.clone(),
        }
    }
    pub(crate) fn z_axis(&self) -> Point3d {
        match self {
            SketchSurface::Plane(plane) => plane.z_axis.clone(),
            SketchSurface::Face(face) => face.z_axis.clone(),
        }
    }
}

pub struct GetTangentialInfoFromPathsResult {
    pub center_or_tangent_point: [f64; 2],
    pub is_center: bool,
    pub ccw: bool,
}

impl SketchGroup {
    pub(crate) fn add_tag(&mut self, tag: &TagDeclarator, current_path: &Path) {
        let mut tag_identifier: TagIdentifier = tag.into();
        let base = current_path.get_base();
        tag_identifier.info = Some(TagEngineInfo {
            id: base.geo_meta.id,
            sketch_group: self.id,
            path: Some(base.clone()),
            surface: None,
        });

        self.tags.insert(tag.name.to_string(), tag_identifier);
    }

    /// Get the path most recently sketched.
    pub(crate) fn latest_path(&self) -> Option<&Path> {
        self.value.last()
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

/// An extrude group is a collection of extrude surfaces.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct ExtrudeGroup {
    /// The id of the extrude group.
    pub id: uuid::Uuid,
    /// The extrude surfaces.
    pub value: Vec<ExtrudeSurface>,
    /// The sketch group.
    pub sketch_group: SketchGroup,
    /// The height of the extrude group.
    pub height: f64,
    /// The id of the extrusion start cap
    pub start_cap_id: Option<uuid::Uuid>,
    /// The id of the extrusion end cap
    pub end_cap_id: Option<uuid::Uuid>,
    /// Chamfers or fillets on this extrude group.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cuts: Vec<EdgeCut>,
    /// Metadata.
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

impl ExtrudeGroup {
    pub(crate) fn get_all_edge_cut_ids(&self) -> Vec<uuid::Uuid> {
        self.edge_cuts.iter().map(|foc| foc.id()).collect()
    }
}

/// An extrude group ID and its fillet and chamfer IDs.  This is needed for lazy
/// fillet evaluation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
pub struct ExtrudeGroupLazyIds {
    pub extrude_group_id: uuid::Uuid,
    pub sketch_group_id: uuid::Uuid,
    /// Chamfers or fillets on this extrude group.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cuts: Vec<uuid::Uuid>,
}

impl From<&ExtrudeGroup> for ExtrudeGroupLazyIds {
    fn from(eg: &ExtrudeGroup) -> Self {
        Self {
            extrude_group_id: eg.id,
            sketch_group_id: eg.sketch_group.id,
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
        tag: Box<Option<TagDeclarator>>,
    },
    /// A chamfer.
    Chamfer {
        /// The id of the engine command that called this chamfer.
        id: uuid::Uuid,
        length: f64,
        /// The engine id of the edge to chamfer.
        #[serde(rename = "edgeId")]
        edge_id: uuid::Uuid,
        tag: Box<Option<TagDeclarator>>,
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

    pub fn tag(&self) -> Option<TagDeclarator> {
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

impl From<Point2d> for kittycad::types::Point2D {
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

#[derive(Debug, Deserialize, Serialize, PartialEq, Clone, ts_rs::TS, JsonSchema, Default)]
#[ts(export)]
pub struct Point3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point3d {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
}

impl From<Point3d> for kittycad::types::Point3D {
    fn from(p: Point3d) -> Self {
        Self { x: p.x, y: p.y, z: p.z }
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

impl From<&ExpressionStatement> for Metadata {
    fn from(exp_statement: &ExpressionStatement) -> Self {
        Self {
            source_range: SourceRange::new(exp_statement.start, exp_statement.end),
        }
    }
}

impl From<&ReturnStatement> for Metadata {
    fn from(return_statement: &ReturnStatement) -> Self {
        Self {
            source_range: SourceRange::new(return_statement.start, return_statement.end),
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
    pub tag: Option<TagDeclarator>,
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
        }
    }

    pub fn get_tag(&self) -> Option<TagDeclarator> {
        match self {
            Path::ToPoint { base } => base.tag.clone(),
            Path::Horizontal { base, .. } => base.tag.clone(),
            Path::AngledLineTo { base, .. } => base.tag.clone(),
            Path::Base { base } => base.tag.clone(),
            Path::TangentialArcTo { base, .. } => base.tag.clone(),
            Path::TangentialArc { base, .. } => base.tag.clone(),
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
        }
    }
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
    pub tag: Option<TagDeclarator>,
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
    pub tag: Option<TagDeclarator>,
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
    pub tag: Option<TagDeclarator>,
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
    pub tag: Option<TagDeclarator>,
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

    pub fn get_tag(&self) -> Option<TagDeclarator> {
        match self {
            ExtrudeSurface::ExtrudePlane(ep) => ep.tag.clone(),
            ExtrudeSurface::ExtrudeArc(ea) => ea.tag.clone(),
            ExtrudeSurface::Fillet(f) => f.tag.clone(),
            ExtrudeSurface::Chamfer(c) => c.tag.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PipeInfo {
    pub previous_results: Option<KclValue>,
}

impl PipeInfo {
    pub fn new() -> Self {
        Self { previous_results: None }
    }
}

impl Default for PipeInfo {
    fn default() -> Self {
        Self::new()
    }
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
    /// Mock mode is only for the modeling app when they just want to mock engine calls and not
    /// actually make them.
    pub is_mock: bool,
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
    // Show grid?
    pub show_grid: bool,
}

impl Default for ExecutorSettings {
    fn default() -> Self {
        Self {
            units: Default::default(),
            highlight_edges: true,
            enable_ssao: false,
            show_grid: false,
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
        }
    }
}

impl ExecutorContext {
    /// Create a new default executor context.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new(client: &kittycad::Client, settings: ExecutorSettings) -> Result<Self> {
        let ws = client
            .modeling()
            .commands_ws(
                None,
                None,
                if settings.enable_ssao {
                    Some(kittycad::types::PostEffectType::Ssao)
                } else {
                    None
                },
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
                &kittycad::types::ModelingCmd::EdgeLinesVisible {
                    hidden: !settings.highlight_edges,
                },
            )
            .await?;

        Ok(Self {
            engine,
            fs: Arc::new(FileManager::new()),
            stdlib: Arc::new(StdLib::new()),
            settings,
            is_mock: false,
        })
    }

    /// For executing unit tests.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new_for_unit_test(units: UnitLength, engine_addr: Option<String>) -> Result<Self> {
        let user_agent = concat!(env!("CARGO_PKG_NAME"), ".rs/", env!("CARGO_PKG_VERSION"));
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

        let token = std::env::var("KITTYCAD_API_TOKEN").expect("KITTYCAD_API_TOKEN not set");

        // Create the client.
        let mut client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);
        // Set a local engine address if it's set.
        if let Ok(addr) = std::env::var("LOCAL_ENGINE_ADDR") {
            client.set_base_url(addr);
        }
        if let Some(addr) = engine_addr {
            client.set_base_url(addr);
        }

        let ctx = ExecutorContext::new(
            &client,
            ExecutorSettings {
                units,
                highlight_edges: true,
                enable_ssao: false,
                show_grid: false,
            },
        )
        .await?;
        Ok(ctx)
    }

    pub async fn reset_scene(&self, source_range: crate::executor::SourceRange) -> Result<()> {
        self.engine.clear_scene(source_range).await?;
        Ok(())
    }

    /// Perform the execution of a program.
    /// You can optionally pass in some initialization memory.
    /// Kurt uses this for partial execution.
    pub async fn run(
        &self,
        program: &crate::ast::types::Program,
        memory: Option<ProgramMemory>,
    ) -> Result<ProgramMemory, KclError> {
        // Before we even start executing the program, set the units.
        self.engine
            .batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                SourceRange::default(),
                &kittycad::types::ModelingCmd::SetSceneUnits {
                    unit: self.settings.units.into(),
                },
            )
            .await?;
        let mut memory = if let Some(memory) = memory {
            memory.clone()
        } else {
            Default::default()
        };
        let mut dynamic_state = DynamicState::default();
        self.inner_execute(
            program,
            &mut memory,
            &mut dynamic_state,
            crate::executor::BodyType::Root,
        )
        .await
    }

    /// Execute an AST's program.
    #[async_recursion]
    pub(crate) async fn inner_execute(
        &self,
        program: &crate::ast::types::Program,
        memory: &mut ProgramMemory,
        dynamic_state: &mut DynamicState,
        body_type: BodyType,
    ) -> Result<ProgramMemory, KclError> {
        let pipe_info = PipeInfo::default();

        // Iterate over the body of the program.
        for statement in &program.body {
            match statement {
                BodyItem::ExpressionStatement(expression_statement) => {
                    let metadata = Metadata::from(expression_statement);
                    // Discard return value.
                    self.execute_expr(
                        &expression_statement.expression,
                        memory,
                        dynamic_state,
                        &pipe_info,
                        &metadata,
                        StatementKind::Expression,
                    )
                    .await?;
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    for declaration in &variable_declaration.declarations {
                        let var_name = declaration.id.name.to_string();
                        let source_range = SourceRange::from(&declaration.init);
                        let metadata = Metadata { source_range };

                        let memory_item = self
                            .execute_expr(
                                &declaration.init,
                                memory,
                                dynamic_state,
                                &pipe_info,
                                &metadata,
                                StatementKind::Declaration { name: &var_name },
                            )
                            .await?;
                        memory.add(&var_name, memory_item, source_range)?;
                    }
                }
                BodyItem::ReturnStatement(return_statement) => {
                    let metadata = Metadata::from(return_statement);
                    let value = self
                        .execute_expr(
                            &return_statement.argument,
                            memory,
                            dynamic_state,
                            &pipe_info,
                            &metadata,
                            StatementKind::Expression,
                        )
                        .await?;
                    memory.return_ = Some(value);
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

        Ok(memory.clone())
    }

    pub async fn execute_expr<'a>(
        &self,
        init: &Expr,
        memory: &mut ProgramMemory,
        dynamic_state: &DynamicState,
        pipe_info: &PipeInfo,
        metadata: &Metadata,
        statement_kind: StatementKind<'a>,
    ) -> Result<KclValue, KclError> {
        let item = match init {
            Expr::None(none) => KclValue::from(none),
            Expr::Literal(literal) => KclValue::from(literal),
            Expr::TagDeclarator(tag) => tag.execute(memory).await?,
            Expr::Identifier(identifier) => {
                let value = memory.get(&identifier.name, identifier.into())?;
                value.clone()
            }
            Expr::BinaryExpression(binary_expression) => {
                binary_expression
                    .get_result(memory, dynamic_state, pipe_info, self)
                    .await?
            }
            Expr::FunctionExpression(function_expression) => {
                let mem_func = force_memory_function(
                    |args: Vec<KclValue>,
                     memory: ProgramMemory,
                     function_expression: Box<FunctionExpression>,
                     _metadata: Vec<Metadata>,
                     mut dynamic_state: DynamicState,
                     ctx: ExecutorContext| {
                        Box::pin(async move {
                            // Create a new environment to execute the function
                            // body in so that local variables shadow variables
                            // in the parent scope.  The new environment's
                            // parent should be the environment of the closure.
                            let mut body_memory = memory.clone();
                            let closure_env = memory.current_env;
                            let body_env = body_memory.new_env_for_call(closure_env);
                            body_memory.current_env = body_env;
                            let mut fn_memory = assign_args_to_params(&function_expression, args, body_memory)?;

                            let result = ctx
                                .inner_execute(
                                    &function_expression.body,
                                    &mut fn_memory,
                                    &mut dynamic_state,
                                    BodyType::Block,
                                )
                                .await?;

                            Ok(result.return_)
                        })
                    },
                );
                // Cloning memory here is crucial for semantics so that we close
                // over variables.  Variables defined lexically later shouldn't
                // be available to the function body.
                KclValue::Function {
                    expression: function_expression.clone(),
                    meta: vec![metadata.to_owned()],
                    func: Some(mem_func),
                    memory: Box::new(memory.clone()),
                }
            }
            Expr::CallExpression(call_expression) => {
                call_expression.execute(memory, dynamic_state, pipe_info, self).await?
            }
            Expr::PipeExpression(pipe_expression) => {
                pipe_expression
                    .get_result(memory, dynamic_state, pipe_info, self)
                    .await?
            }
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
                StatementKind::Expression => match pipe_info.previous_results.clone() {
                    Some(x) => x,
                    None => {
                        return Err(KclError::Semantic(KclErrorDetails {
                            message: "cannot use % outside a pipe expression".to_owned(),
                            source_ranges: vec![pipe_substitution.into()],
                        }));
                    }
                },
            },
            Expr::ArrayExpression(array_expression) => {
                array_expression.execute(memory, dynamic_state, pipe_info, self).await?
            }
            Expr::ObjectExpression(object_expression) => {
                object_expression
                    .execute(memory, dynamic_state, pipe_info, self)
                    .await?
            }
            Expr::MemberExpression(member_expression) => member_expression.get_result(memory)?,
            Expr::UnaryExpression(unary_expression) => {
                unary_expression
                    .get_result(memory, dynamic_state, pipe_info, self)
                    .await?
            }
        };
        Ok(item)
    }

    /// Update the units for the executor.
    pub fn update_units(&mut self, units: UnitLength) {
        self.settings.units = units;
    }

    /// Execute the program, then get a PNG screenshot.
    pub async fn execute_and_prepare_snapshot(&self, program: &Program) -> Result<kittycad::types::TakeSnapshot> {
        let _ = self.run(program, None).await?;

        // Zoom to fit.
        self.engine
            .send_modeling_cmd(
                uuid::Uuid::new_v4(),
                crate::executor::SourceRange::default(),
                kittycad::types::ModelingCmd::ZoomToFit {
                    object_ids: Default::default(),
                    padding: 0.1,
                },
            )
            .await?;

        // Send a snapshot request to the engine.
        let resp = self
            .engine
            .send_modeling_cmd(
                uuid::Uuid::new_v4(),
                crate::executor::SourceRange::default(),
                kittycad::types::ModelingCmd::TakeSnapshot {
                    format: kittycad::types::ImageFormat::Png,
                },
            )
            .await?;

        let kittycad::types::OkWebSocketResponseData::Modeling {
            modeling_response: kittycad::types::OkModelingCmdResponse::TakeSnapshot { data },
        } = resp
        else {
            anyhow::bail!("Unexpected response from engine: {:?}", resp);
        };
        Ok(data)
    }
}

/// For each argument given,
/// assign it to a parameter of the function, in the given block of function memory.
/// Returns Err if too few/too many arguments were given for the function.
fn assign_args_to_params(
    function_expression: &FunctionExpression,
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
                let none = KclNone {
                    start: param.identifier.start,
                    end: param.identifier.end,
                };
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

pub enum StatementKind<'a> {
    Declaration { name: &'a str },
    Expression,
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use pretty_assertions::assert_eq;

    use super::*;
    use crate::ast::types::{Identifier, Parameter};

    pub async fn parse_execute(code: &str) -> Result<ProgramMemory> {
        let tokens = crate::token::lexer(code)?;
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast()?;
        let ctx = ExecutorContext {
            engine: Arc::new(Box::new(crate::engine::conn_mock::EngineConnection::new().await?)),
            fs: Arc::new(crate::fs::FileManager::new()),
            stdlib: Arc::new(crate::std::StdLib::new()),
            settings: Default::default(),
            is_mock: true,
        };
        let memory = ctx.run(&program, None).await?;

        Ok(memory)
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
    |> circle([0, 0], 1, %, $tag1)
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
    |> circle([0, 0], 1, %, $tag1)
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
        fn ident(s: &'static str) -> Identifier {
            Identifier {
                start: 0,
                end: 0,
                name: s.to_owned(),
                digest: None,
            }
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
            let func_expr = &FunctionExpression {
                start: 0,
                end: 0,
                params,
                body: crate::ast::types::Program {
                    start: 0,
                    end: 0,
                    body: Vec::new(),
                    non_code_meta: Default::default(),
                    digest: None,
                },
                return_type: None,
                digest: None,
            };
            let actual = assign_args_to_params(func_expr, args, ProgramMemory::new());
            assert_eq!(
                actual, expected,
                "failed test '{test_name}':\ngot {actual:?}\nbut expected\n{expected:?}"
            );
        }
    }

    #[test]
    fn test_serialize_memory_item() {
        let mem = KclValue::ExtrudeGroups {
            value: Default::default(),
        };
        let json = serde_json::to_string(&mem).unwrap();
        assert_eq!(json, r#"{"type":"ExtrudeGroups","value":[]}"#);
    }
}
