use kittycad_modeling_cmds::ok_response::output as mout;
use pyo3::{PyResult, pyclass, pymethods};

/// Resulting bounding-box data from a `BoundingBox` modeling command.
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass]
#[derive(Debug, Clone, Copy)]
pub struct BoundingBoxResponse {
    center: super::Point3d,
    dimensions: super::Point3d,
}

impl From<mout::BoundingBox> for BoundingBoxResponse {
    fn from(value: mout::BoundingBox) -> Self {
        Self {
            center: value.center.into(),
            dimensions: value.dimensions.into(),
        }
    }
}

impl From<&mout::BoundingBox> for BoundingBoxResponse {
    fn from(value: &mout::BoundingBox) -> Self {
        Self {
            center: value.center.into(),
            dimensions: value.dimensions.into(),
        }
    }
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl BoundingBoxResponse {
    fn get_center(&self) -> PyResult<super::Point3d> {
        Ok(self.center)
    }

    fn get_dimensions(&self) -> PyResult<super::Point3d> {
        Ok(self.dimensions)
    }
}
