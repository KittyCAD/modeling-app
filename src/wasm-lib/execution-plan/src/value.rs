use crate::ExecutionError;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A value stored in KCEP program memory.
#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
pub enum Value {
    String(String),
    NumericValue(NumericValue),
    Uuid(Uuid),
}

impl From<Uuid> for Value {
    fn from(u: Uuid) -> Self {
        Self::Uuid(u)
    }
}

impl From<String> for Value {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<f64> for Value {
    fn from(value: f64) -> Self {
        Self::NumericValue(NumericValue::Float(value))
    }
}

impl TryFrom<Value> for String {
    type Error = ExecutionError;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        if let Value::String(s) = value {
            Ok(s)
        } else {
            Err(ExecutionError::MemoryWrongType {
                expected: "string",
                actual: format!("{value:?}"),
            })
        }
    }
}

impl TryFrom<Value> for Uuid {
    type Error = ExecutionError;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        if let Value::Uuid(u) = value {
            Ok(u)
        } else {
            Err(ExecutionError::MemoryWrongType {
                expected: "uuid",
                actual: format!("{value:?}"),
            })
        }
    }
}

impl TryFrom<Value> for f64 {
    type Error = ExecutionError;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        if let Value::NumericValue(NumericValue::Float(x)) = value {
            Ok(x)
        } else {
            Err(ExecutionError::MemoryWrongType {
                expected: "float",
                actual: format!("{value:?}"),
            })
        }
    }
}

#[cfg(test)]
impl From<usize> for Value {
    fn from(value: usize) -> Self {
        Self::NumericValue(NumericValue::Integer(value))
    }
}

#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
pub enum NumericValue {
    Integer(usize),
    Float(f64),
}
