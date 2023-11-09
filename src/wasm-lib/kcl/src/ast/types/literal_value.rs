use databake::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value as JValue;

use super::{Literal, Value};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(untagged, rename_all = "snake_case")]
pub enum LiteralValue {
    IInteger(i64),
    Fractional(f64),
    String(String),
}

impl From<Literal> for Value {
    fn from(literal: Literal) -> Self {
        Value::Literal(Box::new(literal))
    }
}

impl From<LiteralValue> for JValue {
    fn from(value: LiteralValue) -> Self {
        match value {
            LiteralValue::IInteger(x) => x.into(),
            LiteralValue::Fractional(x) => x.into(),
            LiteralValue::String(x) => x.into(),
        }
    }
}

impl From<f64> for LiteralValue {
    fn from(value: f64) -> Self {
        Self::Fractional(value)
    }
}

impl From<i64> for LiteralValue {
    fn from(value: i64) -> Self {
        Self::IInteger(value)
    }
}

impl From<String> for LiteralValue {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<u32> for LiteralValue {
    fn from(value: u32) -> Self {
        Self::IInteger(value as i64)
    }
}
impl From<u16> for LiteralValue {
    fn from(value: u16) -> Self {
        Self::IInteger(value as i64)
    }
}
impl From<u8> for LiteralValue {
    fn from(value: u8) -> Self {
        Self::IInteger(value as i64)
    }
}
impl From<&'static str> for LiteralValue {
    fn from(value: &'static str) -> Self {
        // TODO: Make this Cow<str>
        Self::String(value.to_owned())
    }
}
