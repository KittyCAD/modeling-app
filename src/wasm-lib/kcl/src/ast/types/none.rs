//! KCL has optional parameters. Their type is [`KclOption`].
//! If an optional parameter is not given, it will have a value of type [`KclNone`].
use databake::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::ConstraintLevel,
    executor::{MemoryItem, SourceRange, UserVal},
};

/// KCL value for an optional parameter which was not given an argument.
/// (remember, parameters are in the function declaration,
/// arguments are in the function call/application).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake, Default)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct KclNone {
    // TODO: Convert this to be an Option<SourceRange>.
    pub start: usize,
    pub end: usize,
}

impl From<&KclNone> for SourceRange {
    fn from(v: &KclNone) -> Self {
        Self([v.start, v.end])
    }
}

impl From<&KclNone> for UserVal {
    fn from(none: &KclNone) -> Self {
        UserVal {
            value: serde_json::to_value(none).expect("can always serialize a None"),
            meta: Default::default(),
        }
    }
}

impl From<&KclNone> for MemoryItem {
    fn from(none: &KclNone) -> Self {
        let val = UserVal::from(none);
        MemoryItem::UserVal(val)
    }
}

impl KclNone {
    pub fn source_range(&self) -> SourceRange {
        SourceRange([self.start, self.end])
    }

    /// Get the constraint level.
    /// KCL None is never constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::None {
            source_ranges: vec![self.source_range()],
        }
    }
}
