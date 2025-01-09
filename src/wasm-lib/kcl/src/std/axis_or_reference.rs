//! Types for referencing an axis or edge.

use anyhow::Result;
use kcmc::length_unit::LengthUnit;
use kittycad_modeling_cmds::{self as kcmc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{errors::KclError, std::fillet::EdgeReference};

/// A 2D axis or tagged edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum Axis2dOrEdgeReference {
    /// 2D axis and origin.
    Axis(AxisAndOrigin2d),
    /// Tagged edge.
    Edge(EdgeReference),
}

/// A 2D axis and origin.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum AxisAndOrigin2d {
    /// X-axis.
    #[serde(rename = "X", alias = "x")]
    X,
    /// Y-axis.
    #[serde(rename = "Y", alias = "y")]
    Y,
    /// Flip the X-axis.
    #[serde(rename = "-X", alias = "-x")]
    NegX,
    /// Flip the Y-axis.
    #[serde(rename = "-Y", alias = "-y")]
    NegY,
    Custom {
        /// The axis.
        axis: [f64; 2],
        /// The origin.
        origin: [f64; 2],
    },
}

impl AxisAndOrigin2d {
    /// Get the axis and origin.
    pub fn axis_and_origin(&self) -> Result<(kcmc::shared::Point3d<f64>, kcmc::shared::Point3d<LengthUnit>), KclError> {
        let (axis, origin) = match self {
            AxisAndOrigin2d::X => ([1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin2d::Y => ([0.0, 1.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin2d::NegX => ([-1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin2d::NegY => ([0.0, -1.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin2d::Custom { axis, origin } => ([axis[0], axis[1], 0.0], [origin[0], origin[1], 0.0]),
        };

        Ok((
            kcmc::shared::Point3d {
                x: axis[0],
                y: axis[1],
                z: axis[2],
            },
            kcmc::shared::Point3d {
                x: LengthUnit(origin[0]),
                y: LengthUnit(origin[1]),
                z: LengthUnit(origin[2]),
            },
        ))
    }
}

/// A 3D axis or tagged edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum Axis3dOrEdgeReference {
    /// 3D axis and origin.
    Axis(AxisAndOrigin3d),
    /// Tagged edge.
    Edge(EdgeReference),
}

/// A 3D axis and origin.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum AxisAndOrigin3d {
    /// X-axis.
    #[serde(rename = "X", alias = "x")]
    X,
    /// Y-axis.
    #[serde(rename = "Y", alias = "y")]
    Y,
    /// Z-axis.
    #[serde(rename = "Z", alias = "z")]
    Z,
    /// Flip the X-axis.
    #[serde(rename = "-X", alias = "-x")]
    NegX,
    /// Flip the Y-axis.
    #[serde(rename = "-Y", alias = "-y")]
    NegY,
    /// Flip the Z-axis.
    #[serde(rename = "-Z", alias = "-z")]
    NegZ,
    Custom {
        /// The axis.
        axis: [f64; 3],
        /// The origin.
        origin: [f64; 3],
    },
}

impl AxisAndOrigin3d {
    /// Get the axis and origin.
    pub fn axis_and_origin(&self) -> Result<(kcmc::shared::Point3d<f64>, kcmc::shared::Point3d<LengthUnit>), KclError> {
        let (axis, origin) = match self {
            AxisAndOrigin3d::X => ([1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin3d::Y => ([0.0, 1.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin3d::Z => ([0.0, 0.0, 1.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin3d::NegX => ([-1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin3d::NegY => ([0.0, -1.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin3d::NegZ => ([0.0, 0.0, -1.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin3d::Custom { axis, origin } => {
                ([axis[0], axis[1], axis[2]], [origin[0], origin[1], origin[2]])
            }
        };

        Ok((
            kcmc::shared::Point3d {
                x: axis[0],
                y: axis[1],
                z: axis[2],
            },
            kcmc::shared::Point3d {
                x: LengthUnit(origin[0]),
                y: LengthUnit(origin[1]),
                z: LengthUnit(origin[2]),
            },
        ))
    }
}

#[cfg(test)]
mod tests {

    use pretty_assertions::assert_eq;

    use crate::std::axis_or_reference::{
        Axis2dOrEdgeReference, Axis3dOrEdgeReference, AxisAndOrigin2d, AxisAndOrigin3d,
    };

    #[test]
    fn test_deserialize_revolve_axis_2d() {
        let data = Axis2dOrEdgeReference::Axis(AxisAndOrigin2d::X);
        let mut str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, "\"X\"");

        str_json = "\"Y\"".to_string();
        let data: Axis2dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, Axis2dOrEdgeReference::Axis(AxisAndOrigin2d::Y));

        str_json = "\"-Y\"".to_string();
        let data: Axis2dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, Axis2dOrEdgeReference::Axis(AxisAndOrigin2d::NegY));

        str_json = "\"-x\"".to_string();
        let data: Axis2dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, Axis2dOrEdgeReference::Axis(AxisAndOrigin2d::NegX));

        let data = Axis2dOrEdgeReference::Axis(AxisAndOrigin2d::Custom {
            axis: [0.0, -1.0],
            origin: [1.0, 0.0],
        });
        str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, r#"{"custom":{"axis":[0.0,-1.0],"origin":[1.0,0.0]}}"#);

        str_json = r#"{"custom": {"axis": [0,-1], "origin": [1,2.0]}}"#.to_string();
        let data: Axis2dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            Axis2dOrEdgeReference::Axis(AxisAndOrigin2d::Custom {
                axis: [0.0, -1.0],
                origin: [1.0, 2.0]
            })
        );
    }

    #[test]
    fn test_deserialize_revolve_axis_3d() {
        let data = Axis3dOrEdgeReference::Axis(AxisAndOrigin3d::X);
        let mut str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, "\"X\"");

        str_json = "\"Y\"".to_string();
        let data: Axis3dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, Axis3dOrEdgeReference::Axis(AxisAndOrigin3d::Y));

        str_json = "\"Z\"".to_string();
        let data: Axis3dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, Axis3dOrEdgeReference::Axis(AxisAndOrigin3d::Z));

        str_json = "\"-Y\"".to_string();
        let data: Axis3dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, Axis3dOrEdgeReference::Axis(AxisAndOrigin3d::NegY));

        str_json = "\"-x\"".to_string();
        let data: Axis3dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, Axis3dOrEdgeReference::Axis(AxisAndOrigin3d::NegX));

        str_json = "\"-z\"".to_string();
        let data: Axis3dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, Axis3dOrEdgeReference::Axis(AxisAndOrigin3d::NegZ));

        let data = Axis3dOrEdgeReference::Axis(AxisAndOrigin3d::Custom {
            axis: [0.0, -1.0, 0.0],
            origin: [1.0, 0.0, 0.0],
        });
        str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, r#"{"custom":{"axis":[0.0,-1.0,0.0],"origin":[1.0,0.0,0.0]}}"#);

        str_json = r#"{"custom": {"axis": [0,-1,0], "origin": [1,2.0,0]}}"#.to_string();
        let data: Axis3dOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            Axis3dOrEdgeReference::Axis(AxisAndOrigin3d::Custom {
                axis: [0.0, -1.0, 0.0],
                origin: [1.0, 2.0, 0.0]
            })
        );
    }
}
