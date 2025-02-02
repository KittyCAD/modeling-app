use indexmap::IndexMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{ArtifactId, KclValue};
use crate::{docs::StdLibFn, std::get_stdlib_fn, SourceRange};

/// A CAD modeling operation for display in the feature tree, AKA operations
/// timeline.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
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
    UserDefinedFunctionCall {
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
        /// The source range of the operation in the source code.
        source_range: SourceRange,
    },
    UserDefinedFunctionReturn,
}

impl Operation {
    /// If the variant is `StdLibCall`, set the `is_error` field.
    pub(crate) fn set_std_lib_call_is_error(&mut self, is_err: bool) {
        match self {
            Self::StdLibCall { ref mut is_error, .. } => *is_error = is_err,
            Self::UserDefinedFunctionCall { .. } | Self::UserDefinedFunctionReturn => {}
        }
    }
}

/// An argument to a CAD modeling operation.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OpArg {
    /// The runtime value of the argument, only if it's a non-composite
    /// primitive value.  We don't include all values since they can be quite
    /// large, and we don't actually need them.
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<KclValue>,
    /// The artifact ID of the value.  This will be `None` for primitive values,
    /// and `Some` for values that have `ArtifactId`s.  If the value is an
    /// array, this will be the artifact IDs of the elements.  Only one level of
    /// nesting is supported.  If the value is an array of arrays, for example,
    /// this will be an empty array.
    #[serde(skip_serializing_if = "Option::is_none")]
    artifact_ids: Option<Vec<ArtifactId>>,
    /// The KCL code expression for the argument.  This is used in the UI so
    /// that the user can edit the expression.
    source_range: SourceRange,
}

impl OpArg {
    pub(crate) fn new(
        value: Option<KclValue>,
        artifact_ids: Option<Vec<ArtifactId>>,
        source_range: SourceRange,
    ) -> Self {
        Self {
            value,
            artifact_ids,
            source_range,
        }
    }
}

/// A reference to a standard library function.  This exists to implement
/// `PartialEq` and `Eq` for `Operation`.
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export)]
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
