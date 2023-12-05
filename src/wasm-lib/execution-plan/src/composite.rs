use crate::{ExecutionError, Value};

/// Types that can be written to or read from KCEP program memory,
/// but require multiple values to store.
/// They get laid out into multiple consecutive memory addresses.
pub trait Composite: Sized {
    /// Store the value in memory.
    fn into_parts(self) -> Vec<Value>;
    /// Read the value from memory.
    fn from_parts(values: &[Option<Value>]) -> Result<Self, ExecutionError>;
}

impl Composite for kittycad::types::Point3D {
    fn into_parts(self) -> Vec<Value> {
        let points = [self.x, self.y, self.z];
        points
            .into_iter()
            .map(|x| Value::NumericValue(crate::NumericValue::Float(x)))
            .collect()
    }

    fn from_parts(values: &[Option<Value>]) -> Result<Self, ExecutionError> {
        let err = ExecutionError::MemoryWrongSize { expected: 3 };
        let [x, y, z] = [0, 1, 2].map(|n| values.get(n).ok_or(err.clone()));
        let x = x?.to_owned().ok_or(err.clone())?.try_into()?;
        let y = y?.to_owned().ok_or(err.clone())?.try_into()?;
        let z = z?.to_owned().ok_or(err.clone())?.try_into()?;
        Ok(Self { x, y, z })
    }
}
