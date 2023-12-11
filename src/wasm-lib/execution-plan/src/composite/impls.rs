use kittycad_modeling_cmds::{id::ModelingCmdId, shared::Point3d, MovePathPen};
use uuid::Uuid;

use crate::{Address, ExecutionError, Value};

use super::Composite;

impl Composite for kittycad_modeling_cmds::shared::Point3d<f64> {
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

const START_PATH: &str = "StartPath";
const MOVE_PATH_PEN: &str = "MovePathPen";

impl Composite for kittycad_modeling_cmds::ModelingCmd {
    fn into_parts(self) -> Vec<Value> {
        let (endpoint_name, params) = match self {
            kittycad_modeling_cmds::ModelingCmd::StartPath => (START_PATH, vec![]),
            kittycad_modeling_cmds::ModelingCmd::MovePathPen(MovePathPen { path, to }) => {
                let to = to.into_parts();
                let mut vals = Vec::with_capacity(1 + to.len());
                vals.push(Value::Uuid(path.into()));
                vals.extend(to);
                (MOVE_PATH_PEN, vals)
            }
            _ => todo!(),
        };
        let mut out = Vec::with_capacity(params.len() + 1);
        out.push(endpoint_name.to_owned().into());
        out.extend(params);
        out
    }

    fn from_parts(values: &[Option<Value>]) -> Result<Self, ExecutionError> {
        // Check the array has an element at index 0
        let first_memory = values
            .get(0)
            .ok_or(ExecutionError::MemoryWrongSize { expected: 1 })?
            .to_owned();
        // The element should be Some
        let first_memory = first_memory.ok_or(ExecutionError::MemoryWrongSize { expected: 1 })?;
        let endpoint_name: String = first_memory.try_into()?;
        match endpoint_name.as_str() {
            START_PATH => Ok(Self::StartPath),
            MOVE_PATH_PEN => {
                let path = get_some(values, 1)?;
                let path = Uuid::try_from(path)?;
                let path = ModelingCmdId::from(path);
                let to = Point3d::from_parts(&values[2..])?;
                let params = MovePathPen { path, to };
                Ok(Self::MovePathPen(params))
            }
            other => return Err(ExecutionError::UnrecognizedEndpoint(other.to_owned())),
        }
    }
}

fn get_some(values: &[Option<Value>], i: usize) -> Result<Value, ExecutionError> {
    let addr = Address(0); // TODO: pass the `start` addr in
    let v = values.get(i).ok_or(ExecutionError::MemoryEmpty { addr })?.to_owned();
    let v = v.ok_or(ExecutionError::MemoryEmpty { addr })?.to_owned();
    Ok(v)
}
