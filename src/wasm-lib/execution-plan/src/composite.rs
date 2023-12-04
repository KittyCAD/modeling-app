use crate::{ExecutionError, NumericValue, Value};

/// Types that can be written to or read from KCEP program memory,
/// but require multiple values to store.
/// They get laid out into multiple consecutive memory addresses.
pub trait Composite<const SIZE: usize>: Sized {
    /// Store the value in memory.
    fn into_parts(self) -> [Value; SIZE];
    /// Read the value from memory.
    fn from_parts(values: [Value; SIZE]) -> Result<Self, ExecutionError>;
}

impl Composite<3> for kittycad::types::Point3D {
    fn into_parts(self) -> [Value; 3] {
        [self.x, self.y, self.z]
            .map(NumericValue::Float)
            .map(Value::NumericValue)
    }

    fn from_parts(values: [Value; 3]) -> Result<Self, ExecutionError> {
        let [x, y, z] = values;
        let x = x.try_into()?;
        let y = y.try_into()?;
        let z = z.try_into()?;
        Ok(Self { x, y, z })
    }
}
