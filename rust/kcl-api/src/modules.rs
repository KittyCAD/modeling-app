use core::fmt;

use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::TypedPath;

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize, Hash, ts_rs::TS, JsonSchema)]
#[serde(tag = "type")]
pub enum ModulePath {
    // The main file of the project.
    Main,
    Local {
        value: TypedPath,
        original_import_path: Option<TypedPath>,
    },
    Std {
        value: String,
    },
}

impl fmt::Display for ModulePath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ModulePath::Main => write!(f, "main"),
            ModulePath::Local { value: path, .. } => path.fmt(f),
            ModulePath::Std { value: s } => write!(f, "std::{s}"),
        }
    }
}
