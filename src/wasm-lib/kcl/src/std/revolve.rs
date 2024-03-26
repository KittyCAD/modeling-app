//! Standard library revolution surfaces.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::extrude::do_post_extrude;
use crate::{
    errors::KclError,
    executor::{ExtrudeGroup, MemoryItem, SketchGroup},
    std::Args,
};

/// Data for revolution surfaces.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct RevolveData {
    /// Angle to revolve (in degrees). Default is 360.
    #[serde(default)]
    pub angle: Option<f64>,
    /// Axis of revolution.
    pub axis: RevolveAxis,
}

/// Axis of revolution.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub enum RevolveAxis {
    /// X-axis.
    #[serde(alias = "x")]
    X,
    /// Y-axis.
    #[serde(alias = "y")]
    Y,
    /// Z-axis.
    #[serde(alias = "z")]
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
}

impl RevolveAxis {
    /// Get the axis around 0,0,0 origin.
    pub fn axis_from_origin(&self) -> Result<kittycad::types::Point3D, KclError> {
        let axis = match self {
            RevolveAxis::X => [1.0, 0.0, 0.0],
            RevolveAxis::Y => [0.0, 1.0, 0.0],
            RevolveAxis::Z => [0.0, 0.0, 1.0],
            RevolveAxis::NegX => [-1.0, 0.0, 0.0],
            RevolveAxis::NegY => [0.0, -1.0, 0.0],
            RevolveAxis::NegZ => [0.0, 0.0, -1.0],
        };

        Ok(kittycad::types::Point3D {
            x: axis[0],
            y: axis[1],
            z: axis[2],
        })
    }
}

/// Revolve a sketch around an axis.
pub async fn revolve(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (RevolveData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let extrude_group = inner_revolve(data, sketch_group, args).await?;
    Ok(MemoryItem::ExtrudeGroup(extrude_group))
}

/// Revolve a sketch around an axis.
///
/// ```no_run
/// const part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line([2, 0], %)
///     |> line([0, -6], %)
///     |> line([4, -6], %)
///     |> line([0, -6], %)
///     |> line([-3.75, -4.5], %)
///     |> line([0, -5.5], %)
///     |> line([-2, 0], %)
///     |> close(%)
///     |> revolve({axis: 'y'}, %)
/// ```
#[stdlib {
    name = "revolve",
}]
async fn inner_revolve(
    data: RevolveData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<ExtrudeGroup>, KclError> {
    let id = uuid::Uuid::new_v4();
    args.send_modeling_cmd(
        id,
        ModelingCmd::Revolve {
            angle: kittycad::types::Angle::from_degrees(data.angle.unwrap_or(360.0)),
            target: sketch_group.id,
            axis: data.axis.axis_from_origin()?,
            origin: kittycad::types::Point3D { x: 0.0, y: 0.0, z: 0.0 },
        },
    )
    .await?;

    do_post_extrude(sketch_group, 0.0, id, args).await
}
