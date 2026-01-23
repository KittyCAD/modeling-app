//! For creating equivalents to the core kcmc types that support Python.
use kittycad_modeling_cmds as kcmc;
use pyo3::{pyclass, pymethods};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, PartialEq, Debug, Clone, Copy)]
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass]
pub struct Point3d {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl Point3d {
    #[new]
    /// Create a new point from its 3 components x, y and z
    /// All of them take floating point values.
    fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }
}

#[derive(Serialize, Deserialize, PartialEq, Debug, Clone, Copy)]
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass]
pub struct CameraLookAt {
    pub vantage: Point3d,
    pub center: Point3d,
    pub up: Point3d,
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl CameraLookAt {
    #[new]
    fn new(vantage: Point3d, center: Point3d, up: Point3d) -> Self {
        Self { vantage, center, up }
    }
}

impl From<CameraLookAt> for kcmc::DefaultCameraLookAt {
    fn from(CameraLookAt { vantage, center, up }: CameraLookAt) -> Self {
        Self::builder()
            .vantage(vantage.into())
            .center(center.into())
            .up(up.into())
            .build()
    }
}

impl From<Point3d> for kcmc::shared::Point3d<f32> {
    fn from(Point3d { x, y, z }: Point3d) -> Self {
        Self { x, y, z }
    }
}
