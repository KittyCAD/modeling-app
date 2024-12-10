use indexmap::IndexMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{docs::StdLibFn, std::get_stdlib_fn, SourceRange};

/// A CAD modeling operation for display in the feature tree, AKA operations
/// timeline.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Operation {
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
    },
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

/// An argument to a CAD modeling operation.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct OpArg {
    /// The KCL code expression for the argument.  This is used in the UI so
    /// that the user can edit the expression.
    source_range: SourceRange,
}

impl OpArg {
    pub(crate) fn new(source_range: SourceRange) -> Self {
        Self { source_range }
    }
}

/// A reference to a standard library function.  This exists to implement
/// `PartialEq` and `Eq` for `Operation`.
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct StdLibFnRef {
    /// We serialize to its name.
    #[serde(
        serialize_with = "std_lib_fn_name",
        deserialize_with = "std_lib_fn_from_name",
        rename = "name"
    )]
    #[ts(type = "string")]
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
