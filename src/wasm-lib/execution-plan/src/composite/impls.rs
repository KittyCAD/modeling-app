use crate::{ExecutionError, Value};

use super::Composite;

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
