//! For creating equivalents to the core kcmc types that support Python.
use kittycad_modeling_cmds as kcmc;
use pyo3::pyclass;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, PartialEq, Debug, Clone, Copy)]
#[pyclass]
pub struct Point3d {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Serialize, Deserialize, PartialEq, Debug, Clone, Copy)]
#[pyclass]
pub struct CameraLookAt {
    pub vantage: Point3d,
    pub center: Point3d,
    pub up: Point3d,
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
