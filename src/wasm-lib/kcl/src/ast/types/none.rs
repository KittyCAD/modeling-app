//! KCL has optional parameters. Their type is [`KclOption`].
//! If an optional parameter is not given, it will have a value of type [`KclNone`].
use databake::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::ConstraintLevel,
    executor::{KclValue, SourceRange, UserVal},
};

const KCL_NONE_ID: &str = "KCL_NONE_ID";

/// KCL value for an optional parameter which was not given an argument.
/// (remember, parameters are in the function declaration,
/// arguments are in the function call/application).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake, Default)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
pub struct KclNone {
    pub r#type: super::KclNoneTag,
    // TODO: Convert this to be an Option<SourceRange>.
    pub start: usize,
    pub end: usize,
    #[serde(deserialize_with = "deser_private")]
    #[ts(skip)]
    #[schemars(skip)]
    __private: Private,
}

impl KclNone {
    pub fn new(start: usize, end: usize) -> Self {
        Self {
            r#type: Default::default(),
            start,
            end,
            __private: Private {},
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Bake, Default)]
#[databake(path = kcl_lib::ast::types)]
struct Private;

impl Serialize for Private {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(KCL_NONE_ID)
    }
}

fn deser_private<'de, D>(deserializer: D) -> Result<Private, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    if s == KCL_NONE_ID {
        Ok(Private {})
    } else {
        Err(serde::de::Error::custom("not a KCL none"))
    }
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

impl From<&KclNone> for KclValue {
    fn from(none: &KclNone) -> Self {
        let val = UserVal::from(none);
        KclValue::UserVal(val)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn other_types_will_not_deserialize() {
        // This shouldn't deserialize into a KCL None,
        // because it's missing the special Private tag.
        let j = r#"{"start": 0, "end": 0}"#;
        let _e = serde_json::from_str::<KclNone>(j).unwrap_err();
    }
    #[test]
    fn serialize_then_deserialize() {
        // Serializing, then deserializing a None should produce the same value.
        let before = KclNone::default();
        let j = serde_json::to_string_pretty(&before).unwrap();
        let after: KclNone = serde_json::from_str(&j).unwrap();
        assert_eq!(before, after);
    }
}
