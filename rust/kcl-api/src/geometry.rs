use parse_display::{Display, FromStr};
use serde::{Deserialize, Serialize};

use crate::{ArtifactId, ObjectId, metadata::Metadata, point::Point3d};

type Point3D = crate::point::Point3d<f64>;

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Plane {
    /// The id of the plane.
    pub id: uuid::Uuid,
    /// The artifact ID.
    pub artifact_id: ArtifactId,
    /// The scene object ID. If this is None, then the plane has not been
    /// sent to the engine yet. It must be sent before it is used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object_id: Option<ObjectId>,
    /// The kind of plane or custom.
    pub kind: PlaneKind,
    /// The information for the plane.
    #[serde(flatten)]
    pub info: PlaneInfo,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

/// Kind of plane.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, ts_rs::TS, FromStr, Display)]
#[ts(export)]
#[display(style = "camelCase")]
pub enum PlaneKind {
    #[serde(rename = "XY", alias = "xy")]
    #[display("XY")]
    XY,
    #[serde(rename = "XZ", alias = "xz")]
    #[display("XZ")]
    XZ,
    #[serde(rename = "YZ", alias = "yz")]
    #[display("YZ")]
    YZ,
    /// A custom plane.
    #[display("Custom")]
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PlaneInfo {
    /// Origin of the plane.
    pub origin: Point3d,
    /// What should the plane's X axis be?
    pub x_axis: Point3d,
    /// What should the plane's Y axis be?
    pub y_axis: Point3d,
    /// What should the plane's Z axis be?
    pub z_axis: Point3d,
}

/// Orientation data that can be used to construct a plane, not a plane in itself.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)]
pub enum PlaneData {
    /// The XY plane.
    #[serde(rename = "XY", alias = "xy")]
    XY,
    /// The opposite side of the XY plane.
    #[serde(rename = "-XY", alias = "-xy")]
    NegXY,
    /// The XZ plane.
    #[serde(rename = "XZ", alias = "xz")]
    XZ,
    /// The opposite side of the XZ plane.
    #[serde(rename = "-XZ", alias = "-xz")]
    NegXZ,
    /// The YZ plane.
    #[serde(rename = "YZ", alias = "yz")]
    YZ,
    /// The opposite side of the YZ plane.
    #[serde(rename = "-YZ", alias = "-yz")]
    NegYZ,
    /// A defined plane.
    Plane(PlaneInfo),
}

impl From<&PlaneData> for PlaneKind {
    fn from(value: &PlaneData) -> Self {
        match value {
            PlaneData::XY => PlaneKind::XY,
            PlaneData::NegXY => PlaneKind::XY,
            PlaneData::XZ => PlaneKind::XZ,
            PlaneData::NegXZ => PlaneKind::XZ,
            PlaneData::YZ => PlaneKind::YZ,
            PlaneData::NegYZ => PlaneKind::YZ,
            PlaneData::Plane(_) => PlaneKind::Custom,
        }
    }
}

impl From<&PlaneInfo> for PlaneKind {
    fn from(value: &PlaneInfo) -> Self {
        let data = PlaneData::Plane(value.clone());
        PlaneKind::from(&data)
    }
}

impl From<PlaneInfo> for PlaneKind {
    fn from(value: PlaneInfo) -> Self {
        let data = PlaneData::Plane(value);
        PlaneKind::from(&data)
    }
}
