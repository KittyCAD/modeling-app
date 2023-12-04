use crate::{ExecutionError, Value};

/// Types that can be written to or read from KCEP program memory,
/// but require multiple values to store.
/// They get laid out into multiple consecutive memory addresses.
pub trait Composite: Sized {
    /// Store the value in memory.
    fn into_parts(self) -> Vec<Value>;
    /// Read the value from memory.
    fn from_parts(values: Vec<Value>) -> Result<Self, ExecutionError>;
    /// How many memory addresses are required to store this value?
    const SIZE: usize;
}

impl Composite for kittycad::types::Point3D {
    fn into_parts(self) -> Vec<Value> {
        let points = [self.x, self.y, self.z];
        points
            .into_iter()
            .map(|x| Value::NumericValue(crate::NumericValue::Float(x)))
            .collect()
    }

    const SIZE: usize = 3;

    fn from_parts(values: Vec<Value>) -> Result<Self, ExecutionError> {
        let n = values.len();
        let Ok([x, y, z]): Result<[Value; 3], _> = values.try_into() else {
            return Err(ExecutionError::MemoryWrongSize {
                actual: n,
                expected: Self::SIZE,
            });
        };
        let x = x.try_into()?;
        let y = y.try_into()?;
        let z = z.try_into()?;
        Ok(Self { x, y, z })
    }
}
