//! For creating equivalents to the core kcmc types that support Python.
use kittycad_modeling_cmds as kcmc;
use pyo3::pyclass;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
#[pyclass]
pub struct Point3d {
    x: f32,
    y: f32,
    z: f32,
}

#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
#[pyclass]
pub struct CameraLookAt {
    vantage: Point3d,
    center: Point3d,
    up: Point3d,
}

impl From<CameraLookAt> for kcmc::DefaultCameraLookAt {
    fn from(CameraLookAt { vantage, center, up }: CameraLookAt) -> Self {
        Self {
            vantage: vantage.into(),
            center: center.into(),
            up: up.into(),
            sequence: None,
        }
    }
}

impl From<Point3d> for kcmc::shared::Point3d<f32> {
    fn from(Point3d { x, y, z }: Point3d) -> Self {
        Self { x, y, z }
    }
}
