use indexmap::IndexMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{types::NumericType, ArtifactId, KclValue};
use crate::{docs::StdLibFn, std::get_stdlib_fn, ModuleId, SourceRange};

/// A CAD modeling operation for display in the feature tree, AKA operations
/// timeline.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export_to = "Operation.ts")]
#[serde(tag = "type")]
pub enum Operation {
    #[serde(rename_all = "camelCase")]
    StdLibCall {
        /// The standard library function being called.
        #[serde(flatten)]
        std_lib_fn: StdLibFnRef,
        /// The unlabeled argument to the function.
        unlabeled_arg: Option<OpArg>,
        /// The labeled keyword arguments to the function.
        labeled_args: IndexMap<String, OpArg>,
        /// The source range of the operation in the source code.
        source_range: SourceRange,
        /// True if the operation resulted in an error.
        #[serde(default, skip_serializing_if = "is_false")]
        is_error: bool,
    },
    #[serde(rename_all = "camelCase")]
    KclStdLibCall {
        name: String,
        /// The unlabeled argument to the function.
        unlabeled_arg: Option<OpArg>,
        /// The labeled keyword arguments to the function.
        labeled_args: IndexMap<String, OpArg>,
        /// The source range of the operation in the source code.
        source_range: SourceRange,
        /// True if the operation resulted in an error.
        #[serde(default, skip_serializing_if = "is_false")]
        is_error: bool,
    },
    #[serde(rename_all = "camelCase")]
    GroupBegin {
        /// The details of the group.
        group: Group,
        /// The source range of the operation in the source code.
        source_range: SourceRange,
    },
    GroupEnd,
}

impl Operation {
    /// If the variant is `StdLibCall`, set the `is_error` field.
    pub(crate) fn set_std_lib_call_is_error(&mut self, is_err: bool) {
        match self {
            Self::StdLibCall { ref mut is_error, .. } => *is_error = is_err,
            Self::KclStdLibCall { ref mut is_error, .. } => *is_error = is_err,
            Self::GroupBegin { .. } | Self::GroupEnd => {}
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export_to = "Operation.ts")]
#[serde(tag = "type")]
pub enum Group {
    /// A function call.
    #[serde(rename_all = "camelCase")]
    FunctionCall {
        /// The name of the user-defined function being called.  Anonymous
        /// functions have no name.
        name: Option<String>,
        /// The location of the function being called so that there's enough
        /// info to go to its definition.
        function_source_range: SourceRange,
        /// The unlabeled argument to the function.
        unlabeled_arg: Option<OpArg>,
        /// The labeled keyword arguments to the function.
        labeled_args: IndexMap<String, OpArg>,
    },
    /// A whole-module import use.
    #[serde(rename_all = "camelCase")]
    ModuleInstance {
        /// The name of the module being used.
        name: String,
        /// The ID of the module which can be used to determine its path.
        module_id: ModuleId,
    },
}

/// An argument to a CAD modeling operation.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export_to = "Operation.ts")]
#[serde(rename_all = "camelCase")]
pub struct OpArg {
    /// The runtime value of the argument.  Instead of using [`KclValue`], we
    /// refer to scene objects using their [`ArtifactId`]s.
    value: OpKclValue,
    /// The KCL code expression for the argument.  This is used in the UI so
    /// that the user can edit the expression.
    source_range: SourceRange,
}

impl OpArg {
    pub(crate) fn new(value: OpKclValue, source_range: SourceRange) -> Self {
        Self { value, source_range }
    }
}

/// A reference to a standard library function.  This exists to implement
/// `PartialEq` and `Eq` for `Operation`.
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export_to = "Operation.ts")]
#[serde(rename_all = "camelCase")]
pub struct StdLibFnRef {
    // The following doc comment gets inlined into Operation, overriding what's
    // there, in the generated TS.  We serialize to its name.  Renaming the
    // field to "name" allows it to match the other variant.
    /// The standard library function being called.
    #[serde(
        rename = "name",
        serialize_with = "std_lib_fn_name",
        deserialize_with = "std_lib_fn_from_name"
    )]
    #[ts(type = "string", rename = "name")]
    pub std_lib_fn: Box<dyn StdLibFn>,
}

impl StdLibFnRef {
    pub(crate) fn new(std_lib_fn: Box<dyn StdLibFn>) -> Self {
        Self { std_lib_fn }
    }
}

impl From<&Box<dyn StdLibFn>> for StdLibFnRef {
    fn from(std_lib_fn: &Box<dyn StdLibFn>) -> Self {
        Self::new(std_lib_fn.clone())
    }
}

impl PartialEq for StdLibFnRef {
    fn eq(&self, other: &Self) -> bool {
        self.std_lib_fn.name() == other.std_lib_fn.name()
    }
}

impl Eq for StdLibFnRef {}

#[expect(clippy::borrowed_box, reason = "Explicit Box is needed for serde")]
fn std_lib_fn_name<S>(std_lib_fn: &Box<dyn StdLibFn>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    let name = std_lib_fn.name();
    serializer.serialize_str(&name)
}

fn std_lib_fn_from_name<'de, D>(deserializer: D) -> Result<Box<dyn StdLibFn>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    if let Some(std_lib_fn) = get_stdlib_fn(&s) {
        Ok(std_lib_fn)
    } else {
        Err(serde::de::Error::custom(format!("not a KCL stdlib function: {}", s)))
    }
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// A KCL value used in Operations.  `ArtifactId`s are used to refer to the
/// actual scene objects.  Any data not needed in the UI may be omitted.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export_to = "Operation.ts")]
#[serde(tag = "type")]
pub enum OpKclValue {
    Uuid {
        value: ::uuid::Uuid,
    },
    Bool {
        value: bool,
    },
    Number {
        value: f64,
        ty: NumericType,
    },
    String {
        value: String,
    },
    Array {
        value: Vec<OpKclValue>,
    },
    Object {
        value: OpKclObjectFields,
    },
    TagIdentifier {
        /// The name of the tag identifier.
        value: String,
        /// The artifact ID of the object it refers to.
        artifact_id: Option<ArtifactId>,
    },
    TagDeclarator {
        name: String,
    },
    Plane {
        artifact_id: ArtifactId,
    },
    Face {
        artifact_id: ArtifactId,
    },
    Sketch {
        value: Box<OpSketch>,
    },
    Solid {
        value: Box<OpSolid>,
    },
    Helix {
        value: Box<OpHelix>,
    },
    ImportedGeometry {
        artifact_id: ArtifactId,
    },
    Function {},
    Module {},
    Type {},
    KclNone {},
}

pub type OpKclObjectFields = IndexMap<String, OpKclValue>;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export_to = "Operation.ts")]
#[serde(rename_all = "camelCase")]
pub struct OpSketch {
    artifact_id: ArtifactId,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export_to = "Operation.ts")]
#[serde(rename_all = "camelCase")]
pub struct OpSolid {
    artifact_id: ArtifactId,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export_to = "Operation.ts")]
#[serde(rename_all = "camelCase")]
pub struct OpHelix {
    artifact_id: ArtifactId,
}

impl From<&KclValue> for OpKclValue {
    fn from(value: &KclValue) -> Self {
        match value {
            KclValue::Uuid { value, .. } => Self::Uuid { value: *value },
            KclValue::Bool { value, .. } => Self::Bool { value: *value },
            KclValue::Number { value, ty, .. } => Self::Number {
                value: *value,
                ty: ty.clone(),
            },
            KclValue::String { value, .. } => Self::String { value: value.clone() },
            KclValue::MixedArray { value, .. } | KclValue::HomArray { value, .. } => {
                let value = value.iter().map(Self::from).collect();
                Self::Array { value }
            }
            KclValue::Object { value, .. } => {
                let value = value.iter().map(|(k, v)| (k.clone(), Self::from(v))).collect();
                Self::Object { value }
            }
            KclValue::TagIdentifier(tag_identifier) => Self::TagIdentifier {
                value: tag_identifier.value.clone(),
                artifact_id: tag_identifier.get_cur_info().map(|info| ArtifactId::new(info.id)),
            },
            KclValue::TagDeclarator(node) => Self::TagDeclarator {
                name: node.name.clone(),
            },
            KclValue::Plane { value } => Self::Plane {
                artifact_id: value.artifact_id,
            },
            KclValue::Face { value } => Self::Face {
                artifact_id: value.artifact_id,
            },
            KclValue::Sketch { value } => Self::Sketch {
                value: Box::new(OpSketch {
                    artifact_id: value.artifact_id,
                }),
            },
            KclValue::Solid { value } => Self::Solid {
                value: Box::new(OpSolid {
                    artifact_id: value.artifact_id,
                }),
            },
            KclValue::Helix { value } => Self::Helix {
                value: Box::new(OpHelix {
                    artifact_id: value.artifact_id,
                }),
            },
            KclValue::ImportedGeometry(imported_geometry) => Self::ImportedGeometry {
                artifact_id: ArtifactId::new(imported_geometry.id),
            },
            KclValue::Function { .. } => Self::Function {},
            KclValue::Module { .. } => Self::Module {},
            KclValue::KclNone { .. } => Self::KclNone {},
            KclValue::Type { .. } => Self::Type {},
        }
    }
}
