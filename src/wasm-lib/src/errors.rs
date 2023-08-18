use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, Serialize, Deserialize)]
pub enum KclError {
    #[error("syntax: {0:?}")]
    Syntax(KclErrorDetails),
    #[error("semantic: {0:?}")]
    Semantic(KclErrorDetails),
    #[error("type: {0:?}")]
    Type(KclErrorDetails),
    #[error("unimplemented: {0:?}")]
    Unimplemented(KclErrorDetails),
    #[error("value already defined: {0:?}")]
    ValueAlreadyDefined(KclErrorDetails),
    #[error("undefined value: {0:?}")]
    UndefinedValue(KclErrorDetails),
    #[error("invalid expression: {0:?}")]
    InvalidExpression(crate::math_parser::MathExpression),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KclErrorDetails {
    #[serde(rename = "sourceRanges")]
    pub source_ranges: Vec<[i32; 2]>,
    pub message: String,
}
