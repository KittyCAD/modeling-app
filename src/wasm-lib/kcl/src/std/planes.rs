//! Standard library plane helpers.

use derive_docs::stdlib;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    executor::{ExecState, KclValue, Plane},
    std::{sketch::PlaneData, Args},
};

/// One of the standard planes.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum StandardPlane {
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
}

impl From<StandardPlane> for PlaneData {
    fn from(value: StandardPlane) -> Self {
        match value {
            StandardPlane::XY => PlaneData::XY,
            StandardPlane::NegXY => PlaneData::NegXY,
            StandardPlane::XZ => PlaneData::XZ,
            StandardPlane::NegXZ => PlaneData::NegXZ,
            StandardPlane::YZ => PlaneData::YZ,
            StandardPlane::NegYZ => PlaneData::NegYZ,
        }
    }
}

/// Offset a plane by a distance along its normal.
pub async fn offset_plane(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (std_plane, offset): (StandardPlane, f64) = args.get_data_and_float()?;
    let plane_data = inner_offset_plane(std_plane, offset, exec_state).await?;
    let plane = Plane::from_plane_data(plane_data, exec_state);
    Ok(KclValue::Plane(Box::new(plane)))
}

/// Offset a plane by a distance along its normal.
///
/// For example, if you offset the 'XZ' plane by 10, the new plane will be parallel to the 'XZ'
/// plane and 10 units away from it.
///
/// ```no_run
/// // Loft a square and a circle on the `XY` plane using offset.
/// const squareSketch = startSketchOn('XY')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// const circleSketch = startSketchOn(offsetPlane('XY', 150))
///     |> circle({ center: [0, 100], radius: 50 }, %)
///
/// loft([squareSketch, circleSketch])
/// ```
///
/// ```no_run
/// // Loft a square and a circle on the `XZ` plane using offset.
/// const squareSketch = startSketchOn('XZ')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// const circleSketch = startSketchOn(offsetPlane('XZ', 150))
///     |> circle({ center: [0, 100], radius: 50 }, %)
///
/// loft([squareSketch, circleSketch])
/// ```
///
/// ```no_run
/// // Loft a square and a circle on the `YZ` plane using offset.
/// const squareSketch = startSketchOn('YZ')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// const circleSketch = startSketchOn(offsetPlane('YZ', 150))
///     |> circle({ center: [0, 100], radius: 50 }, %)
///
/// loft([squareSketch, circleSketch])
/// ```
///
/// ```no_run
/// // Loft a square and a circle on the `-XZ` plane using offset.
/// const squareSketch = startSketchOn('-XZ')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// const circleSketch = startSketchOn(offsetPlane('-XZ', -150))
///     |> circle({ center: [0, 100], radius: 50 }, %)
///
/// loft([squareSketch, circleSketch])
/// ```
#[stdlib {
    name = "offsetPlane",
}]
async fn inner_offset_plane(
    std_plane: StandardPlane,
    offset: f64,
    exec_state: &mut ExecState,
) -> Result<PlaneData, KclError> {
    // Convert to the plane type.
    let plane_data: PlaneData = std_plane.into();
    // Convert to a plane.
    let mut plane = Plane::from_plane_data(plane_data, exec_state);

    match std_plane {
        StandardPlane::XY => {
            plane.origin.z += offset;
        }
        StandardPlane::XZ => {
            plane.origin.y -= offset;
        }
        StandardPlane::YZ => {
            plane.origin.x += offset;
        }
        StandardPlane::NegXY => {
            plane.origin.z -= offset;
        }
        StandardPlane::NegXZ => {
            plane.origin.y += offset;
        }
        StandardPlane::NegYZ => {
            plane.origin.x -= offset;
        }
    }

    Ok(PlaneData::Plane {
        origin: Box::new(plane.origin),
        x_axis: Box::new(plane.x_axis),
        y_axis: Box::new(plane.y_axis),
        z_axis: Box::new(plane.z_axis),
    })
}
