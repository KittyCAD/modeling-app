use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KclError {
    #[error("syntax: {0:?}")]
    Syntax(KclErrorDetails),
    #[error("semantic: {0:?}")]
    Semantic(KclErrorDetails),
    #[error("type: {0:?}")]
    Type(KclErrorDetails),
    #[error("unimplemented: {0:?}")]
    Unimplemented(KclErrorDetails),
    #[error("unexpected: {0:?}")]
    Unexpected(KclErrorDetails),
    #[error("value already defined: {0:?}")]
    ValueAlreadyDefined(KclErrorDetails),
    #[error("undefined value: {0:?}")]
    UndefinedValue(KclErrorDetails),
    #[error("invalid expression: {0:?}")]
    InvalidExpression(crate::math_parser::MathExpression),
}

#[derive(Debug, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct KclErrorDetails {
    #[serde(rename = "sourceRanges")]
    pub source_ranges: Vec<[i32; 2]>,
    #[serde(rename = "msg")]
    pub message: String,
}

/// This is different than to_string() in that it will serialize the Error
/// the struct as JSON so we can deserialize it on the js side.
impl From<KclError> for String {
    fn from(error: KclError) -> Self {
        serde_json::to_string(&error).unwrap()
    }
}
