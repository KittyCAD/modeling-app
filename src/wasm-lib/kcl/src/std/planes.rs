//! Standard library plane helpers.

use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Color, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    execution::{ExecState, KclValue, Plane, PlaneType, Point3d},
    std::{sketch::PlaneData, Args},
};

/// One of the standard planes.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
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
    let (plane_data, offset): (PlaneData, f64) = args.get_data_and_float()?;
    let plane = inner_offset_plane(plane_data, offset, exec_state).await?;
    make_offset_plane_in_engine(&plane, exec_state, &args).await?;
    Ok(KclValue::Plane(Box::new(plane)))
}

/// Offset a plane by a distance along its normal.
///
/// For example, if you offset the 'XZ' plane by 10, the new plane will be parallel to the 'XZ'
/// plane and 10 units away from it.
///
/// ```no_run
/// // Loft a square and a circle on the `XY` plane using offset.
/// squareSketch = startSketchOn('XY')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// circleSketch = startSketchOn(offsetPlane('XY', 150))
///     |> circle({ center = [0, 100], radius = 50 }, %)
///
/// loft([squareSketch, circleSketch])
/// ```
///
/// ```no_run
/// // Loft a square and a circle on the `XZ` plane using offset.
/// squareSketch = startSketchOn('XZ')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// circleSketch = startSketchOn(offsetPlane('XZ', 150))
///     |> circle({ center = [0, 100], radius = 50 }, %)
///
/// loft([squareSketch, circleSketch])
/// ```
///
/// ```no_run
/// // Loft a square and a circle on the `YZ` plane using offset.
/// squareSketch = startSketchOn('YZ')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// circleSketch = startSketchOn(offsetPlane('YZ', 150))
///     |> circle({ center = [0, 100], radius = 50 }, %)
///
/// loft([squareSketch, circleSketch])
/// ```
///
/// ```no_run
/// // Loft a square and a circle on the `-XZ` plane using offset.
/// squareSketch = startSketchOn('-XZ')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// circleSketch = startSketchOn(offsetPlane('-XZ', -150))
///     |> circle({ center = [0, 100], radius = 50 }, %)
///
/// loft([squareSketch, circleSketch])
/// ```
/// ```no_run
/// // A circle on the XY plane
/// startSketchOn("XY")
///   |> startProfileAt([0, 0], %)
///   |> circle({ radius = 10, center = [0, 0] }, %)
///   
/// // Triangle on the plane 4 units above
/// startSketchOn(offsetPlane("XY", 4))
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> close(%)
/// ```
///
/// ```no_run
/// sketch001 = startSketchOn('XZ')
/// profile001 = startProfileAt([65.89, 24.98], sketch001)
///   |> xLine(286.79, %)
///   |> line([-165.36, 254.07], %, $seg01)
///   |> lineTo([profileStartX(%), profileStartY(%)], %)
///   |> close(%)
/// extrude001 = extrude(200, profile001)
/// sketch002 = startSketchOn(extrude001, seg01)
/// profile002 = startProfileAt([-83.92, 60.12], sketch002)
///   |> line([62.9, 113.51], %)
///   |> line([69.02, -119.65], %)
///   |> lineTo([profileStartX(%), profileStartY(%)], %)
///   |> close(%)
///  plane001 = offsetPlane(sketch002, 150)
///  sketch003 = startSketchOn(plane001)
///  profile003 = startProfileAt([-83.92, 60.12], sketch002)
///    |> line([62.9, 113.51], %)
///    |> line([69.02, -119.65], %)
///    |> lineTo([profileStartX(%), profileStartY(%)], %)
///    |> close(%)
/// ```
#[stdlib {
    name = "offsetPlane",
}]
async fn inner_offset_plane(plane_data: PlaneData, offset: f64, exec_state: &mut ExecState) -> Result<Plane, KclError> {
    // Convert to a plane.
    let mut plane = Plane::from_plane_data(&plane_data, exec_state);
    // Though offset planes are derived from standard planes, they are not
    // standard planes themselves.
    plane.value = PlaneType::Custom;

    match plane_data {
        PlaneData::XY => {
            plane.origin.z += offset;
        }
        PlaneData::NegXY => {
            plane.origin.z -= offset;
        }
        PlaneData::XZ => {
            plane.origin.y -= offset;
        }
        PlaneData::NegXZ => {
            plane.origin.y += offset;
        }
        PlaneData::YZ => {
            plane.origin.x += offset;
        }
        PlaneData::NegYZ => {
            plane.origin.x -= offset;
        }
        PlaneData::Plane { z_axis, .. } => {
            let offset_vector = Point3d::new(z_axis.x * offset, z_axis.y * offset, z_axis.z * offset);
            plane.origin += &offset_vector;
        }
    }

    Ok(plane)
}

// Engine-side effectful creation of an actual plane object.
// offset planes are shown by default, and hidden by default if they
// are used as a sketch plane. That hiding command is sent within inner_start_profile_at
async fn make_offset_plane_in_engine(plane: &Plane, exec_state: &mut ExecState, args: &Args) -> Result<(), KclError> {
    // Create new default planes.
    let default_size = 100.0;
    let color = Color {
        r: 0.6,
        g: 0.6,
        b: 0.6,
        a: 0.3,
    };

    args.batch_modeling_cmd(
        plane.id,
        ModelingCmd::from(mcmd::MakePlane {
            clobber: false,
            origin: plane.origin.into(),
            size: LengthUnit(default_size),
            x_axis: plane.x_axis.into(),
            y_axis: plane.y_axis.into(),
            hide: Some(false),
        }),
    )
    .await?;

    // Set the color.
    args.batch_modeling_cmd(
        exec_state.id_generator.next_uuid(),
        ModelingCmd::from(mcmd::PlaneSetColor {
            color,
            plane_id: plane.id,
        }),
    )
    .await?;

    Ok(())
}
