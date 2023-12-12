use crate::ExecutionError;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A value stored in KCEP program memory.
#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
pub enum Primitive {
    String(String),
    NumericValue(NumericPrimitive),
    Uuid(Uuid),
}

impl From<Uuid> for Primitive {
    fn from(u: Uuid) -> Self {
        Self::Uuid(u)
    }
}

impl From<String> for Primitive {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<f64> for Primitive {
    fn from(value: f64) -> Self {
        Self::NumericValue(NumericPrimitive::Float(value))
    }
}

impl TryFrom<Primitive> for String {
    type Error = ExecutionError;

    fn try_from(value: Primitive) -> Result<Self, Self::Error> {
        if let Primitive::String(s) = value {
            Ok(s)
        } else {
            Err(ExecutionError::MemoryWrongType {
                expected: "string",
                actual: format!("{value:?}"),
            })
        }
    }
}

impl TryFrom<Primitive> for Uuid {
    type Error = ExecutionError;

    fn try_from(value: Primitive) -> Result<Self, Self::Error> {
        if let Primitive::Uuid(u) = value {
            Ok(u)
        } else {
            Err(ExecutionError::MemoryWrongType {
                expected: "uuid",
                actual: format!("{value:?}"),
            })
        }
    }
}

impl TryFrom<Primitive> for f64 {
    type Error = ExecutionError;

    fn try_from(value: Primitive) -> Result<Self, Self::Error> {
        if let Primitive::NumericValue(NumericPrimitive::Float(x)) = value {
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
impl From<usize> for Primitive {
    fn from(value: usize) -> Self {
        Self::NumericValue(NumericPrimitive::Integer(value))
    }
}

#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
pub enum NumericPrimitive {
    Integer(usize),
    Float(f64),
}
