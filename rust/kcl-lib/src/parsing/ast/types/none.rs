//! KCL has optional parameters. Their type is [`KclOption`].
//! If an optional parameter is not given, it will have a value of type [`KclNone`].
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{super::digest::Digest, Node};
use crate::{execution::KclValue, parsing::ast::types::ConstraintLevel};

const KCL_NONE_ID: &str = "KCL_NONE_ID";

/// KCL value for an optional parameter which was not given an argument.
/// (remember, parameters are in the function declaration,
/// arguments are in the function call/application).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Default, Copy)]
#[ts(export)]
#[serde(tag = "type")]
pub struct KclNone {
    #[serde(deserialize_with = "deser_private")]
    #[ts(skip)]
    #[schemars(skip)]
    __private: Private,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl KclNone {
    pub fn new() -> Self {
        Self {
            __private: Private {},
            digest: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
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

impl From<&KclNone> for KclValue {
    fn from(none: &KclNone) -> Self {
        KclValue::KclNone {
            value: *none,
            meta: Default::default(),
        }
    }
}

impl From<&Node<KclNone>> for KclValue {
    fn from(none: &Node<KclNone>) -> Self {
        Self::from(&none.inner)
    }
}

impl Node<KclNone> {
    /// Get the constraint level.
    /// KCL None is never constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::None {
            source_ranges: self.as_source_ranges(),
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
